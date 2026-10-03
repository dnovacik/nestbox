import { ExternalLink, Loader2, Play, RefreshCw, Square, SquareTerminal } from 'lucide-react';
import { useMemo } from 'react';
import type { DbStatus, PrismaCommand } from '@shared/tools/database/contract';
import { LogView } from '@/components/log/LogView';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { ToolPanelProps } from '../types';
import { REACH_LABELS, TONE_TEXT, targetLabel, urlProblem } from './labels';
import { databaseLogSource, useDatabaseActions, useDatabaseStatus } from './use-database';

const COMMANDS: { id: PrismaCommand; label: string }[] = [
  { id: 'migrate-status', label: 'Migrate status' },
  { id: 'generate', label: 'Generate' },
];

function Summary({ status, projectId }: { status: DbStatus; projectId: string }) {
  const { testLogin } = useDatabaseActions(projectId);
  const target = status.url.state === 'set' ? status.url.target : null;
  const reach = status.reach ? REACH_LABELS[status.reach.result] : null;
  const loginBlocked =
    status.prisma === null ? 'Needs a Prisma schema' : target?.provider === 'mongodb' ? "Prisma can't run SQL against MongoDB" : target === null ? 'No URL to test' : null;
  const busy = status.running.command !== null;
  return (
    <section aria-label="Connection" className="rounded-lg border border-line bg-card p-4">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
        <dt className="text-fg-muted">Variable</dt>
        <dd className="font-mono text-fg">{status.variable}</dd>
        {target ? (
          <>
            <dt className="text-fg-muted">Points to</dt>
            <dd className="truncate font-mono text-fg" title={target.file ?? undefined}>
              {targetLabel(target)}
            </dd>
            <dt className="text-fg-muted">From</dt>
            <dd className="font-mono text-fg">{target.source}</dd>
          </>
        ) : (
          <>
            <dt className="text-fg-muted">Points to</dt>
            <dd className="text-fg-muted">{urlProblem(status)}</dd>
          </>
        )}
        {reach && (
          <>
            <dt className="text-fg-muted">Server</dt>
            <dd className={TONE_TEXT[reach.tone]}>
              {reach.text}
              {status.reach?.reason && <span className="ml-2 text-fg-faint">{status.reach.reason}</span>}
            </dd>
          </>
        )}
        <dt className="text-fg-muted">Login</dt>
        <dd className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" disabled={loginBlocked !== null || busy || testLogin.isPending} title={loginBlocked ?? undefined} onClick={() => testLogin.mutate()}>
            {testLogin.isPending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Test login
          </Button>
          {loginBlocked && <span className="text-fg-faint">{loginBlocked}</span>}
          {testLogin.data && <span className={testLogin.data.ok ? 'text-ok' : 'text-err'}>{testLogin.data.message}</span>}
        </dd>
      </dl>
    </section>
  );
}

function PrismaActions({ status, projectId }: { status: DbStatus; projectId: string }) {
  const actions = useDatabaseActions(projectId);
  const running = status.running.command;
  const studio = status.running.studio;
  return (
    <section aria-label="Prisma" className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card p-4">
      <h3 className="mr-2 text-[10px] font-semibold tracking-wider text-fg-muted uppercase">Prisma</h3>
      {COMMANDS.map((c) => (
        <Button key={c.id} variant="secondary" size="sm" disabled={running !== null} onClick={() => actions.run.mutate(c.id)}>
          {running === c.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
          {c.label}
        </Button>
      ))}
      {running !== null && running !== 'test-login' && (
        <Button variant="ghost" size="sm" onClick={() => actions.stop.mutate('command')}>
          <Square className="size-3.5" aria-hidden />
          Stop
        </Button>
      )}
      <Button variant="secondary" size="sm" title="Opens a terminal: it asks for a migration name" onClick={() => actions.migrateDev.mutate()}>
        <SquareTerminal className="size-3.5" aria-hidden />
        Migrate dev
      </Button>
      <span className="mx-1 h-5 w-px bg-line" aria-hidden />
      {studio ? (
        <>
          <Button variant="secondary" size="sm" onClick={() => void api.app.openExternal(`http://localhost:${studio.port}`)}>
            <ExternalLink className="size-3.5" aria-hidden />
            Open Studio
          </Button>
          <span className="font-mono text-xs text-fg-muted">localhost:{studio.port}</span>
          <Button variant="ghost" size="sm" onClick={() => actions.stop.mutate('studio')}>
            <Square className="size-3.5" aria-hidden />
            Stop Studio
          </Button>
        </>
      ) : (
        <Button variant="secondary" size="sm" disabled={actions.startStudio.isPending} onClick={() => actions.startStudio.mutate()}>
          <Play className="size-3.5" aria-hidden />
          Start Studio
        </Button>
      )}
    </section>
  );
}

/** Where DATABASE_URL points, whether it answers and logs in, and the project's Prisma commands. */
export default function DatabasePanel({ projectId }: ToolPanelProps) {
  const { data: status, isError, refetch, isFetching } = useDatabaseStatus(projectId);
  const source = useMemo(() => databaseLogSource(projectId), [projectId]);
  if (isError) return <p className="text-sm text-fg-muted">Couldn't read the database settings.</p>;
  if (!status) return <p className="text-sm text-fg-muted">Loading…</p>;
  return (
    <section aria-label="Database" className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-fg">Database</h2>
        <Button variant="secondary" size="sm" disabled={isFetching} onClick={() => void refetch()}>
          <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} aria-hidden />
          Refresh
        </Button>
      </div>
      <Summary status={status} projectId={projectId} />
      {status.prisma ? (
        <>
          <PrismaActions status={status} projectId={projectId} />
          <div className="flex min-h-64 flex-1 flex-col">
            <LogView source={source} name="Prisma" emptyHint="Run a Prisma command to see its output." />
          </div>
        </>
      ) : (
        <p className="text-xs text-fg-muted">No Prisma schema in this package: only the connection check is available.</p>
      )}
    </section>
  );
}
