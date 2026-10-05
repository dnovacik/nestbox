import { PROVIDER_LABELS } from '@shared/tools/ci/contract';
import { Button } from '@/components/ui/button';
import { relativeTime } from '@/lib/relative-time';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/state/ui-store';
import type { ToolPanelProps } from '../types';
import { STATE_CLASS, STATE_LABEL } from './labels';
import { useCiStatus } from './use-ci';

/** Local facts only: the card shows the newest run the tab has seen, and never lists runs itself. */
export function CiCard({ projectId }: ToolPanelProps) {
  const { data: status } = useCiStatus(projectId);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  if (!status || status.provider === null) return null;
  const run = status.latest;
  return (
    <section
      aria-label="CI"
      className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4"
    >
      <h3 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">CI</h3>
      <p className="text-xs text-fg-muted">
        {PROVIDER_LABELS[status.provider]}
        {status.branch && (
          <>
            {' · '}
            <span className="font-mono text-fg">{status.branch}</span>
          </>
        )}
      </p>
      {status.cli === 'missing' ? (
        <p className="text-xs text-warn">CLI not installed</p>
      ) : run ? (
        <p className="flex items-center gap-2 text-xs">
          <span className={cn('rounded border px-1.5 text-[10px]', STATE_CLASS[run.state])}>
            {STATE_LABEL[run.state]}
          </span>
          <span className="truncate text-fg">{run.title ?? run.workflow ?? `#${run.id}`}</span>
          {run.updatedAt !== null && (
            <span className="shrink-0 text-fg-faint">{relativeTime(run.updatedAt)}</span>
          )}
        </p>
      ) : (
        <p className="text-xs text-fg-faint">Open the tab to see this branch's runs.</p>
      )}
      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        onClick={() => setActiveTab(projectId, 'ci')}
      >
        Open CI
      </Button>
    </section>
  );
}
