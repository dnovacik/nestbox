import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/state/ui-store';
import type { ToolPanelProps } from '../types';
import { DOT_CLASS, PROBLEM_TEXT, runningCount, serviceTone, stateText } from './labels';
import { useComposeAction, useComposeStatus } from './use-compose';

export function ComposeCard({ projectId }: ToolPanelProps) {
  const { data: status, isError } = useComposeStatus(projectId);
  const act = useComposeAction(projectId);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const busy = act.isPending || (status?.state === 'ok' && status.action !== null);
  return (
    <section
      aria-label="Compose"
      className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4"
    >
      <h3 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">Compose</h3>
      {isError && <p className="text-xs text-fg-muted">Couldn't read the compose services.</p>}
      {status && status.state !== 'ok' && (
        <p className="text-xs text-fg-muted">{PROBLEM_TEXT[status.state]}</p>
      )}
      {status?.state === 'ok' && (
        <>
          <div className="space-y-1.5 text-xs">
            <p className="text-fg">
              {runningCount(status.services)} of {status.services.length} running
            </p>
            <p className="flex flex-wrap gap-1.5">
              {status.services.map((s) => (
                <span
                  key={s.name}
                  title={`${s.name}: ${stateText(s)}`}
                  className={cn('size-2 rounded-full', DOT_CLASS[serviceTone(s)])}
                />
              ))}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => act.mutate({ action: 'up' })}
            >
              Up all
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => act.mutate({ action: 'stop' })}
            >
              Stop all
            </Button>
          </div>
        </>
      )}
      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        onClick={() => setActiveTab(projectId, 'compose')}
      >
        Open Compose
      </Button>
    </section>
  );
}
