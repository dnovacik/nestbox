import type { GitStatus } from '@shared/tools/git/contract';
import { Badge } from '@/components/ui/badge';
import { relativeTime } from '@/lib/relative-time';

type Ok = Extract<GitStatus, { state: 'ok' }>;

const OPERATION_LABELS: Record<NonNullable<Ok['operation']>, string> = {
  merge: 'Merging',
  rebase: 'Rebasing',
  'cherry-pick': 'Cherry-picking',
  revert: 'Reverting',
  bisect: 'Bisecting',
};

const count = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;

/** Branch, changes, upstream and last commit: the overview card and the panel header. */
export function GitSummary({ status }: { status: Ok }) {
  const { changes } = status;
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
      <dt className="text-fg-muted">Branch</dt>
      <dd className="flex min-w-0 items-center gap-2">
        {status.branch !== null ? (
          <span className="truncate font-mono text-fg">{status.branch}</span>
        ) : (
          <span className="truncate text-fg">Detached at {status.detachedAt ?? 'unknown'}</span>
        )}
        {status.operation && <Badge variant="outline" className="border-warn text-warn">{OPERATION_LABELS[status.operation]}</Badge>}
      </dd>

      <dt className="text-fg-muted">Changes</dt>
      <dd className="flex flex-wrap gap-x-2 text-fg">
        {changes.total === 0 ? (
          <span className="text-ok">Clean</span>
        ) : (
          <span>{`${count(changes.total)}${changes.truncated ? '+' : ''} ${changes.total === 1 && !changes.truncated ? 'change' : 'changes'}`}</span>
        )}
        {changes.staged > 0 && <span className="text-fg-muted">{count(changes.staged)} staged</span>}
        {changes.conflicted > 0 && <span className="text-err">{plural(changes.conflicted, 'conflict', 'conflicts')}</span>}
      </dd>

      <dt className="text-fg-muted">Upstream</dt>
      <dd className="flex min-w-0 flex-wrap gap-x-2">
        {status.upstream === null ? (
          <span className="text-fg-muted">No upstream</span>
        ) : (
          <>
            {status.ahead !== null && status.behind !== null && <span className="font-mono text-fg">{`↑${status.ahead} ↓${status.behind}`}</span>}
            <span className="truncate font-mono text-fg-muted">{status.upstream}</span>
            <span className="text-fg-faint">{status.lastFetchAt === null ? 'never fetched' : `fetched ${relativeTime(status.lastFetchAt)}`}</span>
          </>
        )}
      </dd>

      <dt className="text-fg-muted">Last commit</dt>
      <dd className="min-w-0">
        {status.lastCommit === null ? (
          <span className="text-fg-muted">No commits yet</span>
        ) : (
          <>
            <p className="truncate text-fg" title={status.lastCommit.subject}>
              {status.lastCommit.subject}
            </p>
            <p className="truncate text-fg-faint">{`${status.lastCommit.author} · ${relativeTime(status.lastCommit.at)}`}</p>
          </>
        )}
      </dd>
    </dl>
  );
}

/** The message for a state other than ok; null for ok. */
export function gitProblem(status: GitStatus): string | null {
  switch (status.state) {
    case 'git-missing':
      return 'Git is not installed, or not on PATH.';
    case 'not-a-repo':
      return "Git can't read this folder. It may not be a repository, or git doesn't trust its owner (safe.directory).";
    case 'failed':
      return "Couldn't read git status.";
    case 'ok':
      return null;
  }
}
