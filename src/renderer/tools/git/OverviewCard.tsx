import { Button } from '@/components/ui/button';
import { useUiStore } from '@/state/ui-store';
import type { ToolPanelProps } from '../types';
import { GitSummary, gitProblem } from './Summary';
import { useGitStatus } from './use-git';

export function GitCard({ projectId }: ToolPanelProps) {
  const { data, isError, refetch, isFetching } = useGitStatus(projectId);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const problem = data ? gitProblem(data) : isError ? "Couldn't read git status." : null;
  return (
    <section aria-label="Git" aria-busy={!data && !isError} className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4">
      <h3 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">Git</h3>
      {data?.state === 'ok' && <GitSummary status={data} />}
      {problem && <p className="text-xs text-fg-muted">{problem}</p>}
      <div className="flex gap-2">
        {(isError || data?.state === 'failed') && (
          <Button variant="secondary" size="sm" disabled={isFetching} onClick={() => void refetch()}>
            Retry
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={() => setActiveTab(projectId, 'git')}>
          Open Git
        </Button>
      </div>
    </section>
  );
}
