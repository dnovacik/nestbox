// "Ready to deploy": each check's verdict from the other tools' results. The inputs come through the tool
// host as unknown and are parsed with each tool's own schema; anything unreadable is a skip, never a pass.
import type { EnvCompare, ReadyCheck } from '@shared/tools/deploy/contract';
import { CiLatestSchema } from '@shared/tools/ci/contract';
import { ResultsSchema, summarize } from '@shared/tools/deps/contract';
import { GitStatusSchema } from '@shared/tools/git/contract';
import { NodeStatusSchema, SOURCE_LABELS } from '@shared/tools/node/contract';

type Verdict = Pick<ReadyCheck, 'tone' | 'detail'>;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function nodeCheck(status: unknown): ReadyCheck {
  const parsed = NodeStatusSchema.safeParse(status);
  const check = (v: Verdict): ReadyCheck => ({ kind: 'node', label: 'Node', ...v });
  if (!parsed.success) return check({ tone: 'skip', detail: "Couldn't read the Node check" });
  const { requirement, node } = parsed.data;
  const local = node.version ?? 'not found';
  if (requirement === null)
    return check({
      tone: 'warn',
      detail: `No Node version declared: the platform uses its default (local ${local})`,
    });
  const source = SOURCE_LABELS[requirement];
  if (node.ok === true) return check({ tone: 'ok', detail: `Local ${local} matches ${source}` });
  if (node.ok === false)
    return check({ tone: 'fail', detail: `Local ${local} doesn't match ${source}` });
  return check({ tone: 'warn', detail: `Couldn't compare local ${local} with ${source}` });
}

export function depsCheck(results: unknown, projectId: string): ReadyCheck {
  const parsed = ResultsSchema.safeParse(results);
  const check = (v: Verdict): ReadyCheck => ({ kind: 'deps', label: 'Dependencies', ...v });
  if (!parsed.success)
    return check({ tone: 'skip', detail: "Couldn't read the last dependency check" });
  // A root's results include its workspace packages; a package's are its own.
  const packages = parsed.data.packages;
  if (packages.length === 0) return check({ tone: 'warn', detail: 'Not checked yet' });
  const { high, critical } = summarize(packages);
  const urgent = high + critical;
  if (urgent > 0)
    return check({
      tone: 'warn',
      detail: `${plural(urgent, 'package')} with high or critical advisories`,
    });
  return check({
    tone: 'ok',
    detail: packages.some((p) => p.projectId === projectId)
      ? 'No high or critical advisories'
      : null,
  });
}

export function envCheck(
  compare: EnvCompare,
  platformLabel: string,
  environment: string,
): ReadyCheck {
  const check = (v: Verdict): ReadyCheck => ({ kind: 'env', label: 'Env', ...v });
  if (compare.state === 'no-file') return check({ tone: 'skip', detail: 'No env file' });
  if (compare.state !== 'ok')
    return check({
      tone: 'warn',
      detail: `Couldn't compare with ${platformLabel} (${compare.state})`,
    });
  const missing = compare.onlyLocal;
  if (missing.length > 0)
    return check({
      tone: 'fail',
      detail: `${plural(missing.length, 'key')} missing on ${platformLabel} (${environment}): ${missing.join(', ')}`,
    });
  return check({ tone: 'ok', detail: `Every local key is on ${platformLabel} (${environment})` });
}

export function gitCheck(status: unknown): ReadyCheck {
  const parsed = GitStatusSchema.safeParse(status);
  const check = (v: Verdict): ReadyCheck => ({ kind: 'git', label: 'Git', ...v });
  if (!parsed.success || parsed.data.state !== 'ok')
    return check({ tone: 'skip', detail: 'Not a git repository' });
  const s = parsed.data;
  const problems: string[] = [];
  if (s.changes.total > 0) problems.push(`${plural(s.changes.total, 'uncommitted change')}`);
  if (s.upstream === null) problems.push('No upstream branch');
  else if ((s.ahead ?? 0) > 0) problems.push(`${plural(s.ahead ?? 0, 'commit')} not pushed`);
  return problems.length > 0
    ? check({ tone: 'warn', detail: problems.join(' · ') })
    : check({ tone: 'ok', detail: `Clean and pushed (${s.branch ?? s.detachedAt ?? 'HEAD'})` });
}

const CI_SKIPS: Record<string, string> = {
  'no-provider': 'No GitHub or GitLab remote',
  'cli-missing': "The CI provider's CLI isn't installed",
  'logged-out': 'Not logged in to the CI CLI',
  'no-remote': 'The CI CLI found no remote',
  failed: "Couldn't list CI runs",
  timeout: 'Listing CI runs timed out',
};

/** The current branch's newest run, from the CI tool on the package's repository. */
export function ciCheck(latest: unknown): ReadyCheck {
  const parsed = CiLatestSchema.safeParse(latest);
  const check = (v: Verdict): ReadyCheck => ({ kind: 'ci', label: 'CI', ...v });
  if (!parsed.success) return check({ tone: 'skip', detail: 'CI not set up' });
  if (parsed.data.state !== 'ok')
    return check({ tone: 'skip', detail: CI_SKIPS[parsed.data.state] ?? "Couldn't list CI runs" });
  const { run, branch } = parsed.data;
  if (run === null)
    return check({ tone: 'skip', detail: `No CI runs for ${branch ?? 'this branch'} yet` });
  const where = `on ${run.branch ?? branch ?? 'this branch'}${run.sha ? ` (${run.sha})` : ''}`;
  switch (run.state) {
    case 'success':
      return check({ tone: 'ok', detail: `CI passed ${where}` });
    case 'failure':
      return check({ tone: 'fail', detail: `CI failed ${where}` });
    case 'queued':
    case 'running':
      return check({ tone: 'warn', detail: `Still running ${where}` });
    default:
      return check({ tone: 'warn', detail: `CI ${run.state} ${where}` });
  }
}

export function overall(checks: readonly ReadyCheck[]): 'green' | 'amber' | 'red' {
  if (checks.some((c) => c.tone === 'fail')) return 'red';
  if (checks.some((c) => c.tone === 'warn')) return 'amber';
  return 'green';
}
