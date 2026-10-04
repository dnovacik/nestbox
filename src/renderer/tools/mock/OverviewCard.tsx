import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/errors';
import { useUiStore } from '@/state/ui-store';
import type { ToolPanelProps } from '../types';
import { useMock, useMockActions } from './use-mock';

export function MockCard({ projectId }: ToolPanelProps) {
  const { status, config, isError } = useMock(projectId);
  const { start, stop } = useMockActions(projectId);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const routes = config?.routes.length ?? 0;
  return (
    <section
      aria-label="Mock API"
      className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4"
    >
      <h3 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">Mock API</h3>
      {isError && <p className="text-xs text-fg-muted">Couldn't read the mock API.</p>}
      {status && config && (
        <div className="space-y-1.5 text-xs">
          <p className={status.running ? 'font-mono text-fg' : 'text-fg-muted'}>
            {status.url ?? 'Stopped'}
          </p>
          <p className="text-fg-faint">
            {routes} {routes === 1 ? 'route' : 'routes'}
            {config.failAll.on && (
              <span className="text-err"> · fail all ({config.failAll.status})</span>
            )}
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {status?.running ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={stop.isPending}
            onClick={() => stop.mutate()}
          >
            Stop
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled={!status || start.isPending}
            onClick={() =>
              start.mutate(undefined, { onError: (error) => toast.error(errorMessage(error)) })
            }
          >
            Start
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={() => setActiveTab(projectId, 'mock')}>
          Open Mock API
        </Button>
      </div>
    </section>
  );
}
