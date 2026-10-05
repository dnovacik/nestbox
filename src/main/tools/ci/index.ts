// The CI tool: a repository's GitHub Actions runs or GitLab pipelines, a failed job's log tail, and re-running
// failed jobs, through the provider's own CLI (gh, glab). NestBox keeps no token: the CLI's login is the
// credential. Only a listing, a log or a re-run reaches the network, each from the tab.
import type { ChildProcess } from 'node:child_process';
import { NestboxError } from '@shared/errors';
import {
  type CiFailure,
  type CiJob,
  type CiJobs,
  type CiLatest,
  type CiLog,
  type CiProvider,
  type CiRun,
  type CiRuns,
  type CiStatus,
  ciContract,
  ciDefinition,
  isActive,
  LOG_TAIL_LINES,
} from '@shared/tools/ci/contract';
import { readGitInfo } from '../../detection/git-head';
import type { Logger } from '../../logger';
import { type AnyMainTool, defineMainTool, type ToolContext } from '../types';
import {
  classifyFailure,
  parseGhJobs,
  parseGhRuns,
  parseGlabJobs,
  parseGlabPipelines,
  tailGhLog,
  tailTrace,
} from './parse';
import { detectProvider } from './remote';

export interface CiToolDeps {
  logger: Logger;
  now?: () => number;
  timeoutMs?: number;
}

type Ctx = ToolContext<Record<string, never>>;

const TIMEOUT_MS = 30_000;
const OUTPUT_CAP = 4 * 1024 * 1024;
const SHOWN_RUNS = 15;
/** Retried one at a time; more failed jobs than this is a pipeline to look at on GitLab. */
const MAX_RETRIES = 20;
/** A branch name reaches the command line only when it is this plain. */
const PLAIN_BRANCH = /^[A-Za-z0-9._/-]{1,200}$/;
const GH_FIELDS =
  'databaseId,status,conclusion,workflowName,displayTitle,headBranch,headSha,event,createdAt,updatedAt,url';

const CLI: Record<CiProvider, { command: string; install: string }> = {
  github: { command: 'gh', install: 'https://cli.github.com' },
  gitlab: { command: 'glab', install: 'https://gitlab.com/gitlab-org/cli#installation' },
};

interface ProjectState {
  latest: CiRun | null;
  busy: boolean;
  emitChanged: () => void;
}

interface Resolved {
  provider: CiProvider | null;
  found: boolean;
  branch: string | null;
}

interface Output {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const sameRun = (a: CiRun | null, b: CiRun | null) =>
  a?.id === b?.id && a?.state === b?.state && a?.updatedAt === b?.updatedAt;

export function createCiTool(deps: CiToolDeps): AnyMainTool {
  const now = deps.now ?? Date.now;
  const states = new Map<string, ProjectState>();

  function stateOf(ctx: Ctx): ProjectState {
    const emitChanged = () => ctx.emit('changed', undefined);
    const existing = states.get(ctx.project.id);
    if (existing) {
      existing.emitChanged = emitChanged;
      return existing;
    }
    const created: ProjectState = { latest: null, busy: false, emitChanged };
    states.set(ctx.project.id, created);
    return created;
  }

  async function resolve(ctx: Ctx): Promise<Resolved> {
    const [provider, git] = await Promise.all([
      detectProvider(ctx.project.path),
      readGitInfo(ctx.project.path),
    ]);
    // null (couldn't tell) counts as installed, so the CLI's own error shows.
    const found =
      provider !== null && (await ctx.platform.commandExists(CLI[provider].command)) !== false;
    return { provider, found, branch: git?.branch ?? null };
  }

  /** Throws nothing: a missing provider or CLI is a state the tab explains. */
  async function ready(ctx: Ctx): Promise<(Resolved & { provider: CiProvider }) | CiFailure> {
    const r = await resolve(ctx);
    if (r.provider === null) return 'no-provider';
    if (!r.found) return 'cli-missing';
    return { ...r, provider: r.provider };
  }

  async function run(ctx: Ctx, provider: CiProvider, args: string[]): Promise<Output> {
    let child: ChildProcess;
    try {
      child = ctx.platform.spawnCommand({
        cwd: ctx.project.path,
        command: CLI[provider].command,
        args,
        env: {
          ...(await ctx.platform.resolveShellEnv()),
          NO_COLOR: '1',
          FORCE_COLOR: '0',
          GH_PROMPT_DISABLED: '1',
          GLAB_NO_PROMPT: '1',
        },
      });
    } catch {
      return { code: null, stdout: '', stderr: '', timedOut: false };
    }
    return new Promise((done) => {
      let stdout = '';
      let stderr = '';
      let finished = false;
      let timedOut = false;
      const finish = (code: number | null) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        done({ code, stdout, stderr, timedOut });
      };
      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdout.length < OUTPUT_CAP) stdout += chunk.toString('utf8');
      });
      // Only for classifying a failure: never shown or logged.
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < 64 * 1024) stderr += chunk.toString('utf8');
      });
      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid !== undefined) void ctx.platform.killTree(child.pid).catch(() => undefined);
        finish(null);
      }, deps.timeoutMs ?? TIMEOUT_MS);
      child.once('error', () => finish(null));
      child.once('close', (code: number | null) => finish(code));
    });
  }

  function failureOf(out: Output): CiFailure {
    if (out.timedOut) return 'timeout';
    if (out.code === 0 || out.code === null) return 'failed';
    return classifyFailure(out.stderr);
  }

  function log(
    message: string,
    ctx: Ctx,
    provider: CiProvider | null,
    fields: Record<string, string | number | boolean>,
  ) {
    deps.logger.info(message, {
      projectId: ctx.project.id,
      provider: provider ?? 'none',
      ...fields,
    });
  }

  async function listRuns(ctx: Ctx, scope: 'branch' | 'all'): Promise<CiRuns> {
    const started = now();
    const r = await ready(ctx);
    if (typeof r === 'string') return { state: r };
    const branch = scope === 'branch' ? r.branch : null;
    let args: string[];
    let inMain = branch !== null;
    if (r.provider === 'github') {
      if (branch !== null && PLAIN_BRANCH.test(branch)) {
        args = [
          'run',
          'list',
          '--limit',
          String(SHOWN_RUNS),
          '--json',
          GH_FIELDS,
          '--branch',
          branch,
        ];
        inMain = false;
      } else {
        args = [
          'run',
          'list',
          '--limit',
          String(branch === null ? SHOWN_RUNS : 100),
          '--json',
          GH_FIELDS,
        ];
      }
    } else {
      // glab can't filter by branch on every version: pipelines are filtered by ref here.
      args = ['ci', 'list', '--per-page', '50', '--output', 'json'];
    }
    const out = await run(ctx, r.provider, args);
    const parsed =
      out.code === 0
        ? r.provider === 'github'
          ? parseGhRuns(out.stdout)
          : parseGlabPipelines(out.stdout)
        : null;
    const result: CiRuns =
      parsed === null
        ? { state: failureOf(out) }
        : {
            state: 'ok',
            branch: scope === 'branch' ? r.branch : null,
            filtered: scope === 'branch' && r.branch !== null,
            runs: (inMain ? parsed.filter((x) => x.branch === branch) : parsed).slice(
              0,
              SHOWN_RUNS,
            ),
          };
    if (result.state === 'ok' && r.branch !== null) {
      const newest =
        scope === 'branch'
          ? (result.runs[0] ?? null)
          : (result.runs.find((x) => x.branch === r.branch) ?? stateOf(ctx).latest);
      const state = stateOf(ctx);
      if (!sameRun(state.latest, newest)) {
        state.latest = newest;
        state.emitChanged();
      }
    }
    log('ci runs', ctx, r.provider, {
      scope,
      state: result.state,
      count: result.state === 'ok' ? result.runs.length : 0,
      code: out.code ?? 'none',
      ms: now() - started,
    });
    return result;
  }

  async function listJobs(ctx: Ctx, runId: string): Promise<CiJobs> {
    const r = await ready(ctx);
    if (typeof r === 'string') return { state: r };
    const out = await run(
      ctx,
      r.provider,
      r.provider === 'github'
        ? ['run', 'view', runId, '--json', 'jobs']
        : ['ci', 'get', '--pipeline-id', runId, '--output', 'json'],
    );
    const jobs: CiJob[] | null =
      out.code === 0
        ? r.provider === 'github'
          ? parseGhJobs(out.stdout)
          : parseGlabJobs(out.stdout)
        : null;
    return jobs === null ? { state: failureOf(out) } : { state: 'ok', jobs };
  }

  async function jobLog(ctx: Ctx, runId: string, jobId: string): Promise<CiLog> {
    const started = now();
    const r = await ready(ctx);
    if (typeof r === 'string') return { state: r };
    // The job must belong to the run and be finished: `glab ci trace` follows a running job.
    const jobs = await listJobs(ctx, runId);
    if (jobs.state !== 'ok') return jobs;
    const job = jobs.jobs.find((j) => j.id === jobId);
    if (!job || isActive(job.state)) return { state: 'failed' };
    const out = await run(
      ctx,
      r.provider,
      r.provider === 'github'
        ? ['run', 'view', '--job', jobId, '--log-failed']
        : ['ci', 'trace', jobId],
    );
    const result: CiLog =
      out.code === 0
        ? {
            state: 'ok',
            ...(r.provider === 'github' ? tailGhLog : tailTrace)(out.stdout, LOG_TAIL_LINES),
          }
        : { state: failureOf(out) };
    log('ci job log', ctx, r.provider, {
      state: result.state,
      lines: result.state === 'ok' ? result.lines.length : 0,
      code: out.code ?? 'none',
      ms: now() - started,
    });
    return result;
  }

  async function rerunFailed(ctx: Ctx, runId: string): Promise<{ ok: boolean; retried: number }> {
    const state = stateOf(ctx);
    if (state.busy)
      throw new NestboxError('CONFLICT', 'A re-run is already starting for this project');
    state.busy = true;
    state.emitChanged();
    const started = now();
    let provider: CiProvider | null = null;
    let result = { ok: false, retried: 0 };
    try {
      const r = await ready(ctx);
      if (typeof r === 'string') return result;
      provider = r.provider;
      const jobs = await listJobs(ctx, runId);
      if (jobs.state !== 'ok') return result;
      const failed = jobs.jobs.filter((j) => j.state === 'failure' && !j.allowFailure);
      if (failed.length === 0) return result;
      if (r.provider === 'github') {
        const out = await run(ctx, r.provider, ['run', 'rerun', runId, '--failed']);
        result = { ok: out.code === 0, retried: out.code === 0 ? failed.length : 0 };
      } else {
        let retried = 0;
        for (const job of failed.slice(0, MAX_RETRIES)) {
          const out = await run(ctx, r.provider, ['ci', 'retry', job.id]);
          if (out.code === 0) retried += 1;
        }
        result = { ok: retried === failed.length, retried };
      }
      return result;
    } finally {
      state.busy = false;
      state.emitChanged();
      log('ci rerun', ctx, provider, {
        ok: result.ok,
        retried: result.retried,
        ms: now() - started,
      });
    }
  }

  const handlers = {
    async status(ctx: Ctx): Promise<CiStatus> {
      const r = await resolve(ctx);
      const state = stateOf(ctx);
      const cli = r.provider === null ? null : CLI[r.provider];
      return {
        provider: r.provider,
        cli: r.found ? 'found' : 'missing',
        install: cli?.install ?? null,
        loginCommand: cli === null ? null : `${cli.command} auth login`,
        branch: r.branch,
        latest: state.latest !== null && state.latest.branch === r.branch ? state.latest : null,
        busy: state.busy,
      };
    },
    runs: (ctx: Ctx, { scope }: { scope: 'branch' | 'all' }) => listRuns(ctx, scope),
    jobs: (ctx: Ctx, { runId }: { runId: string }) => listJobs(ctx, runId),
    jobLog: (ctx: Ctx, { runId, jobId }: { runId: string; jobId: string }) =>
      jobLog(ctx, runId, jobId),
    rerunFailed: (ctx: Ctx, { runId }: { runId: string }) => rerunFailed(ctx, runId),
    async latest(ctx: Ctx): Promise<CiLatest> {
      const runs = await listRuns(ctx, 'branch');
      return runs.state === 'ok'
        ? { state: 'ok', branch: runs.branch, run: runs.runs[0] ?? null }
        : runs;
    },
    async login(ctx: Ctx) {
      const r = await resolve(ctx);
      if (r.provider === null) throw new NestboxError('NOT_FOUND', 'No GitHub or GitLab remote');
      if (!r.found) throw new NestboxError('NOT_FOUND', "The CI provider's CLI isn't installed");
      await ctx.platform.openTerminal(ctx.project.path, `${CLI[r.provider].command} auth login`);
    },
  };

  return defineMainTool({
    ...ciDefinition,
    contract: ciContract,
    handlers,
    busy: () => [...states.values()].some((s) => s.busy),
    forgetProject(rootId) {
      states.delete(rootId);
    },
  });
}
