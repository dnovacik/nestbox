import { ExternalLink, Loader2, Play, RotateCw, ScrollText, Square } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ComposeAction, ServiceView } from '@shared/tools/compose/contract';
import { LogView } from '@/components/log/LogView';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { ToolPanelProps } from '../types';
import { DOT_CLASS, isUp, opensInBrowser, PROBLEM_TEXT, serviceTone, stateText } from './labels';
import { composeLogSource, useComposeAction, useComposeStatus, useFollow } from './use-compose';

interface RowProps {
  service: ServiceView;
  busy: boolean;
  running: { name: ComposeAction; service: string | null } | null;
  onAction(action: ComposeAction, service: string): void;
  onLogs(service: string): void;
}

function ServiceRow({ service: s, busy, running, onAction, onLogs }: RowProps) {
  const spinning = (action: ComposeAction) =>
    running?.name === action && running.service === s.name;
  const up = isUp(s);
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-xs">
      <span className={cn('size-2 shrink-0 rounded-full', DOT_CLASS[serviceTone(s)])} />
      <span className="w-40 truncate font-mono text-fg">{s.name}</span>
      <span className="w-40 truncate text-fg-muted">{stateText(s)}</span>
      <span className="flex min-w-0 flex-1 flex-wrap gap-2 font-mono text-fg-faint">
        {s.ports.map((p) => (
          <span key={`${p.published}/${p.protocol}`} className="inline-flex items-center gap-1">
            {p.published}→{p.target}
            {p.protocol !== 'tcp' && `/${p.protocol}`}
            {up && opensInBrowser(p) && (
              <button
                type="button"
                aria-label={`Open localhost:${p.published}`}
                className="text-brand hover:text-brand-hover"
                onClick={() => void api.app.openExternal(`http://localhost:${p.published}`)}
              >
                <ExternalLink className="size-3" aria-hidden />
              </button>
            )}
          </span>
        ))}
      </span>
      {up ? (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Stop ${s.name}`}
          disabled={busy}
          onClick={() => onAction('stop', s.name)}
        >
          {spinning('stop') ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Square className="size-3.5" aria-hidden />
          )}
          Stop
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Start ${s.name}`}
          disabled={busy}
          onClick={() => onAction('up', s.name)}
        >
          {spinning('up') ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Play className="size-3.5" aria-hidden />
          )}
          Start
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Restart ${s.name}`}
        disabled={busy || !up}
        onClick={() => onAction('restart', s.name)}
      >
        <RotateCw className={cn('size-3.5', spinning('restart') && 'animate-spin')} aria-hidden />
        Restart
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Logs of ${s.name}`}
        disabled={s.state === 'not-created'}
        onClick={() => onLogs(s.name)}
      >
        <ScrollText className="size-3.5" aria-hidden />
        Logs
      </Button>
    </li>
  );
}

/** The package's compose services, stack actions and one service's logs. */
export default function ComposePanel({ projectId }: ToolPanelProps) {
  const { data: status, isError } = useComposeStatus(projectId);
  const act = useComposeAction(projectId);
  const [logService, setLogService] = useState<string | null>(null);
  const [confirmDown, setConfirmDown] = useState(false);
  useFollow(projectId, logService);
  const source = useMemo(() => composeLogSource(projectId, logService), [projectId, logService]);

  if (isError) return <p className="text-sm text-fg-muted">Couldn't read the compose services.</p>;
  if (!status) return <p className="text-sm text-fg-muted">Loading…</p>;
  if (status.state !== 'ok') {
    return (
      <section aria-label="Compose" className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-fg">Compose</h2>
        <p className="text-xs text-fg-muted">{PROBLEM_TEXT[status.state]}</p>
        <p className="font-mono text-xs text-fg-faint">{status.file}</p>
      </section>
    );
  }

  const busy = act.isPending || status.action !== null;
  const run = (action: ComposeAction, service?: string) =>
    act.mutate(service === undefined ? { action } : { action, service });
  const stackSpin = (action: ComposeAction) =>
    status.action?.name === action && status.action.service === null;
  const pick = (value: string | null) => (
    <button
      type="button"
      aria-pressed={logService === value}
      onClick={() => setLogService(value)}
      className={cn(
        'rounded border px-2 py-0.5 font-mono text-[11px]',
        logService === value
          ? 'border-brand/40 bg-brand/15 text-brand'
          : 'border-line text-fg-muted hover:text-fg',
      )}
    >
      {value ?? 'Actions'}
    </button>
  );

  return (
    <section aria-label="Compose" className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-fg">Compose</h2>
        <span className="font-mono text-xs text-fg-faint">{status.file}</span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => run('up')}>
            {stackSpin('up') ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Play className="size-3.5" aria-hidden />
            )}
            Up all
          </Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => run('stop')}>
            {stackSpin('stop') ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Square className="size-3.5" aria-hidden />
            )}
            Stop all
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-err"
            disabled={busy}
            onClick={() => setConfirmDown(true)}
          >
            {stackSpin('down') && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Down
          </Button>
        </div>
      </div>
      <p className="text-xs text-fg-faint">
        Docker runs these containers: quitting NestBox leaves them as they are.
      </p>
      {status.services.length === 0 ? (
        <p className="text-xs text-fg-muted">The compose file has no services.</p>
      ) : (
        <ul
          aria-label="Services"
          className="divide-y divide-line rounded-lg border border-line bg-card"
        >
          {status.services.map((s) => (
            <ServiceRow
              key={s.name}
              service={s}
              busy={busy}
              running={status.action}
              onAction={run}
              onLogs={setLogService}
            />
          ))}
        </ul>
      )}
      <div className="flex min-h-64 flex-1 flex-col">
        <LogView
          source={source}
          name={logService ?? 'Compose actions'}
          emptyHint={
            logService === null
              ? 'Output of Up, Stop, Restart and Down shows here.'
              : 'No log lines yet.'
          }
          leading={
            <div className="flex items-center gap-1.5">
              {pick(null)}
              {logService !== null && pick(logService)}
            </div>
          }
        />
      </div>
      <AlertDialog open={confirmDown} onOpenChange={setConfirmDown}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run docker compose down?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes the containers and networks of this compose project. Volumes are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-err text-fg hover:bg-err/90"
              onClick={() => run('down')}
            >
              Remove containers
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
