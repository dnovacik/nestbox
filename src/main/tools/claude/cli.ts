// The Claude Code CLI as NestBox sees it: is it installed, which version, and is a file gitignored.
import type { PlatformAdapter } from '../../platform/adapter';

const STATUS_TTL_MS = 60_000;
const EXEC_TIMEOUT_MS = 10_000;

export interface ClaudeStatus {
  /** null when the lookup isn't possible on this platform. */
  found: boolean | null;
  version: string | null;
}

export interface ClaudeCliDeps {
  platform: Pick<PlatformAdapter, 'commandExists' | 'execCommand'>;
  now(): number;
}

export interface ClaudeCli {
  status(): Promise<ClaudeStatus>;
  /** git check-ignore: true/false, or null when git can't tell (not a repo, git missing). */
  isIgnored(dir: string, file: string): Promise<boolean | null>;
}

export function createClaudeCli({ platform, now }: ClaudeCliDeps): ClaudeCli {
  let cached: { at: number; value: Promise<ClaudeStatus> } | null = null;

  async function lookup(): Promise<ClaudeStatus> {
    const found = await platform.commandExists('claude').catch(() => null);
    if (found !== true) return { found, version: null };
    const result = await platform
      .execCommand('claude', ['--version'], { timeoutMs: EXEC_TIMEOUT_MS })
      .catch(() => null);
    const first = result?.code === 0 ? (result.stdout.split(/\r?\n/)[0]?.trim() ?? '') : '';
    return { found, version: first === '' ? null : first };
  }

  return {
    status() {
      const t = now();
      if (!cached || t - cached.at >= STATUS_TTL_MS) cached = { at: t, value: lookup() };
      return cached.value;
    },
    async isIgnored(dir, file) {
      const result = await platform
        .execCommand('git', ['check-ignore', '-q', file], { cwd: dir, timeoutMs: EXEC_TIMEOUT_MS })
        .catch(() => null);
      if (result?.code === 0) return true;
      if (result?.code === 1) return false;
      return null;
    },
  };
}
