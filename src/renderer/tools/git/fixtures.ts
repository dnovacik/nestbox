import type { GitStatus } from '@shared/tools/git/contract';

type Ok = Extract<GitStatus, { state: 'ok' }>;

/** A clean branch tracking origin/main, for renderer tests. */
export function okStatus(patch: Partial<Ok> = {}): Ok {
  return {
    state: 'ok',
    branch: 'main',
    detachedAt: null,
    operation: null,
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    lastFetchAt: null,
    changes: { total: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, truncated: false },
    files: [],
    lastCommit: { hash: 'abc1234', subject: 'feat: add the engine', author: 'Ada Lovelace', at: Date.now() - 2 * 3_600_000 },
    ...patch,
  };
}
