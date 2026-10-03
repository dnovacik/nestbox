import { RefreshCw } from 'lucide-react';
import { type GitFile, MAX_GIT_FILES } from '@shared/tools/git/contract';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ToolPanelProps } from '../types';
import { GitSummary, gitProblem } from './Summary';
import { useGitStatus, useOpenGitFile } from './use-git';

const GROUPS: { id: GitFile['group']; title: string }[] = [
  { id: 'conflicts', title: 'Conflicts' },
  { id: 'staged', title: 'Staged' },
  { id: 'changes', title: 'Changes' },
  { id: 'untracked', title: 'Untracked' },
];

const STATUS_COLOUR: Record<GitFile['group'], string> = {
  conflicts: 'text-err',
  staged: 'text-ok',
  changes: 'text-warn',
  untracked: 'text-fg-faint',
};

function FileRow({ file, onOpen }: { file: GitFile; onOpen(path: string): void }) {
  const label = file.origPath ? `${file.origPath} → ${file.path}` : file.path;
  return (
    <li className="flex items-center gap-3 rounded px-2 py-1 text-xs hover:bg-hover">
      <span className={cn('w-3 shrink-0 text-center font-mono', STATUS_COLOUR[file.group])} aria-hidden="true">
        {file.status}
      </span>
      <span className={cn('min-w-0 flex-1 truncate font-mono', file.exists ? 'text-fg' : 'text-fg-muted line-through')} title={label}>
        {label}
      </span>
      {file.exists && (
        <Button variant="ghost" size="sm" className="h-6 px-2" aria-label={`Open ${file.path}`} onClick={() => onOpen(file.path)}>
          Open
        </Button>
      )}
    </li>
  );
}

export default function GitPanel({ projectId }: ToolPanelProps) {
  const { data, isError, refetch, isFetching } = useGitStatus(projectId);
  const open = useOpenGitFile(projectId);
  const problem = data ? gitProblem(data) : isError ? "Couldn't read git status." : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-fg">Git</h2>
        <Button variant="secondary" size="sm" disabled={isFetching} onClick={() => void refetch()}>
          <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} aria-hidden="true" />
          Refresh
        </Button>
      </div>
      {problem && <p className="text-xs text-fg-muted">{problem}</p>}
      {data?.state === 'ok' && (
        <>
          <section aria-label="Summary" className="rounded-lg border border-line bg-card p-4">
            <GitSummary status={data} />
          </section>
          {data.changes.total === 0 && <p className="text-xs text-fg-muted">Nothing to commit, working tree clean.</p>}
          {GROUPS.map(({ id, title }) => {
            const files = data.files.filter((f) => f.group === id);
            if (files.length === 0) return null;
            return (
              <section key={id} aria-labelledby={`git-${id}`} className="flex flex-col gap-1">
                <h4 id={`git-${id}`} className="flex items-center gap-2 text-[10px] font-semibold tracking-wider text-fg-muted uppercase">
                  {title}
                  <span className="font-mono text-fg-faint">{files.length}</span>
                </h4>
                <ul className="flex flex-col">
                  {files.map((f) => (
                    <FileRow key={`${f.group}:${f.path}`} file={f} onOpen={(path) => open.mutate(path)} />
                  ))}
                </ul>
              </section>
            );
          })}
          {(data.files.length >= MAX_GIT_FILES || data.changes.truncated) && (
            <p className="text-xs text-fg-muted">{`Only the first ${MAX_GIT_FILES} files are listed.`}</p>
          )}
        </>
      )}
    </div>
  );
}
