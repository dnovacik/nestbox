import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/state/ui-store';
import type { ToolPanelProps } from '../types';
import { shortUrl, statusTone } from './labels';
import { useInspector, useInspectorActions } from './use-inspector';

export function InspectorCard({ projectId }: ToolPanelProps) {
  const { status, entries, isError } = useInspector(projectId);
  const { start, stop } = useInspectorActions(projectId);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const last = entries[0];
  return (
    <section
      aria-label="Inspector"
      className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4"
    >
      <h3 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">
        Inspector
      </h3>
      {isError && <p className="text-xs text-fg-muted">Couldn't read the inspector.</p>}
      {status && (
        <div className="space-y-1.5 text-xs">
          <p className={status.running ? 'font-mono text-fg' : 'text-fg-muted'}>
            {status.running && status.url && status.target
              ? `${shortUrl(status.url)} → ${shortUrl(status.target)}`
              : 'Stopped'}
          </p>
          <p className="text-fg-faint">
            {status.count} {status.count === 1 ? 'request' : 'requests'}
            {status.tunnel.state === 'on' && <span className="text-warn"> · shared publicly</span>}
            {last && (
              <>
                {' · last '}
                <span className={cn('font-mono', statusTone(last.status))}>
                  {last.status ?? last.error}
                </span>
              </>
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
        <Button variant="secondary" size="sm" onClick={() => setActiveTab(projectId, 'inspector')}>
          Open Inspector
        </Button>
      </div>
    </section>
  );
}
