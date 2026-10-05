// Which CI a repository uses, from its remote's host (never the whole URL: it can carry a user or a token)
// and, for other hosts, from the CI files in the folder.
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { CiProvider } from '@shared/tools/ci/contract';
import { resolveGitDirs } from '../../detection/git-head';

/** The host of a remote URL (`https://…`, `ssh://…`, or scp-like `git@host:path`); null for local paths. */
export function hostOf(url: string): string | null {
  const value = url.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'file:' || parsed.hostname === '' ? null : parsed.hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  const scp = /^(?:[^@/\s]+@)?([A-Za-z0-9.-]+):(?!\/\/)/.exec(value);
  return scp?.[1] ? scp[1].toLowerCase() : null;
}

/** The host of `origin`'s URL in a git config, else of the first remote's. */
export function remoteHost(config: string): string | null {
  const urls = new Map<string, string>();
  let remote: string | null = null;
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.trim();
    const section = /^\[\s*([^\s\]]+)(?:\s+"([^"]*)")?\s*\]$/.exec(line);
    if (section) {
      remote = section[1]?.toLowerCase() === 'remote' ? (section[2] ?? null) : null;
      continue;
    }
    const url = /^url\s*=\s*(.+)$/i.exec(line)?.[1];
    if (remote !== null && url && !urls.has(remote)) urls.set(remote, url);
  }
  const url = urls.get('origin') ?? urls.values().next().value;
  return url === undefined ? null : hostOf(url);
}

export function providerFor(
  host: string | null,
  files: { githubWorkflows: boolean; gitlabCi: boolean },
): CiProvider | null {
  if (host !== null) {
    if (host === 'github.com' || host.endsWith('.ghe.com')) return 'github';
    if (host.includes('gitlab')) return 'gitlab';
  }
  if (files.githubWorkflows) return 'github';
  if (files.gitlabCi) return 'gitlab';
  return null;
}

const exists = (path: string) => stat(path).then(
  () => true,
  () => false,
);

export async function detectProvider(dir: string): Promise<CiProvider | null> {
  const dirs = await resolveGitDirs(dir);
  if (dirs === null) return null;
  const config = await readFile(join(dirs.commonDir, 'config'), 'utf8').catch(() => '');
  const [githubWorkflows, gitlabCi] = await Promise.all([
    exists(join(dir, '.github', 'workflows')),
    exists(join(dir, '.gitlab-ci.yml')),
  ]);
  return providerFor(remoteHost(config.slice(0, 256 * 1024)), { githubWorkflows, gitlabCi });
}
