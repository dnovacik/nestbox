import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/state/ui-store';
import type { ToolPanelProps } from '../types';
import { REACH_LABELS, TONE_DOT, TONE_TEXT, targetLabel, urlProblem } from './labels';
import { useDatabaseStatus } from './use-database';

export function DatabaseCard({ projectId }: ToolPanelProps) {
  const { data, isError } = useDatabaseStatus(projectId);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const reach = data?.reach ? REACH_LABELS[data.reach.result] : null;
  const studio = data?.running.studio ?? null;
  const connections = data?.dotnet?.connections ?? [];
  const answering = connections.filter((c) => c.reach.result === 'reachable').length;
  const failing = connections.some((c) => c.reach.result === 'refused' || c.reach.result === 'timeout' || c.reach.result === 'dns');
  const pending = data?.ef?.migrations?.items.filter((m) => m.applied === false).length ?? 0;
  // A .NET package without Prisma or a URL has nothing to say about DATABASE_URL.
  const showUrl = data !== undefined && (data.dotnet === null || data.prisma !== null || data.url.state === 'set');
  return (
    <section aria-label="Database" aria-busy={!data && !isError} className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4">
      <h3 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">Database</h3>
      {isError && <p className="text-xs text-fg-muted">Couldn't read the database settings.</p>}
      {data?.dotnet && (
        <p className={cn('text-xs', failing ? 'text-err' : 'text-fg')}>
          {connections.length === 0
            ? 'No connection strings'
            : `${connections.length} ${connections.length === 1 ? 'connection' : 'connections'} · ${answering} ${answering === 1 ? 'answers' : 'answer'}`}
        </p>
      )}
      {pending > 0 && <p className="text-xs text-warn">{`${pending} pending ${pending === 1 ? 'migration' : 'migrations'}`}</p>}
      {showUrl && data.url.state === 'set' && (
        <div className="space-y-1 text-xs">
          <p className="flex min-w-0 items-baseline gap-2">
            {reach && <span aria-hidden className={cn('size-2 shrink-0 translate-y-[-1px] rounded-full', TONE_DOT[reach.tone])} />}
            <span className="min-w-0 font-mono break-all text-fg">{targetLabel(data.url.target)}</span>
          </p>
          {reach && (
            <p className={TONE_TEXT[reach.tone]} title={data.reach?.reason ?? undefined}>
              {reach.text}
            </p>
          )}
        </div>
      )}
      {showUrl && urlProblem(data) && <p className="text-xs text-fg-muted">{urlProblem(data)}</p>}
      {studio && (
        <button type="button" className="self-start text-xs text-brand hover:underline" onClick={() => void api.app.openExternal(`http://localhost:${studio.port}`)}>
          Studio on localhost:{studio.port}
        </button>
      )}
      <Button variant="secondary" size="sm" className="self-start" onClick={() => setActiveTab(projectId, 'database')}>
        Open Database
      </Button>
    </section>
  );
}
