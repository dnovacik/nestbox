import { ArrowRight, ExternalLink, Play, Square, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NestboxError } from '@shared/errors';
import { type EntryDetail as Detail, LocalUrlSchema } from '@shared/tools/inspector/contract';
import { NumberField } from '@/components/NumberField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import type { ToolPanelProps } from '../types';
import { EntryDetail } from './EntryDetail';
import { clockTime, statusTone } from './labels';
import { SendDialog } from './SendDialog';
import { TunnelBar } from './TunnelBar';
import { useInspector, useInspectorActions } from './use-inspector';

/** The API address: empty means PORT from .env. Saved on blur or Enter; invalid input is shown, not saved. */
function TargetField({
  value,
  fallback,
  onSave,
}: {
  value: string | null;
  fallback: string | null;
  onSave(v: string | null): void;
}) {
  const [text, setText] = useState(value ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => setText(value ?? ''), [value]);
  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === '') {
      setProblem(null);
      if (value !== null) onSave(null);
      return;
    }
    const parsed = LocalUrlSchema.safeParse(trimmed);
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? 'Invalid address');
      return;
    }
    setProblem(null);
    if (parsed.data !== value) onSave(parsed.data);
  };
  return (
    <span className="flex flex-col gap-1">
      <Input
        aria-label="API address"
        value={text}
        placeholder={fallback ? `${fallback} (PORT from .env)` : 'http://localhost:3000'}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="h-7 w-72 font-mono text-xs"
      />
      {problem && <span className="text-[11px] text-err">{problem}</span>}
    </span>
  );
}

/** A proxy in front of the local API: every request is recorded and can be replayed or edited. */
export default function InspectorPanel({ projectId }: ToolPanelProps) {
  const { status, config, entries, isError } = useInspector(projectId);
  const actions = useInspectorActions(projectId);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<Detail | null>(null);
  const [startError, setStartError] = useState<{ message: string; nextPort: number | null } | null>(
    null,
  );

  // A cleared or rotated-out entry can't stay selected.
  useEffect(() => {
    if (selected !== null && !entries.some((e) => e.id === selected)) setSelected(null);
  }, [entries, selected]);

  if (isError) return <p className="text-sm text-fg-muted">Couldn't read the inspector.</p>;
  if (!status || !config) return <p className="text-sm text-fg-muted">Loading…</p>;

  const start = async () => {
    setStartError(null);
    try {
      await actions.start.mutateAsync();
    } catch (error) {
      const busy = error instanceof NestboxError && error.code === 'CONFLICT';
      const next = busy
        ? await api.tools.invoke('inspector', projectId, 'nextFreePort', {}).catch(() => null)
        : null;
      setStartError({ message: errorMessage(error), nextPort: next?.port ?? null });
    }
  };

  const needle = filter.trim().toLowerCase();
  const shown =
    needle === ''
      ? entries
      : entries.filter((e) =>
          `${e.method} ${e.path} ${e.status ?? e.error ?? ''}`.toLowerCase().includes(needle),
        );
  const envTarget = status.targetSource === 'env' ? status.target : null;

  return (
    <section aria-label="Inspector" className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
      <div className="flex flex-wrap items-start gap-3">
        <h2 className="text-sm font-semibold text-fg">Inspector</h2>
        {status.url ? (
          <span className="flex items-center gap-1">
            <span className="font-mono text-xs text-fg select-text">{status.url}</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Open in browser"
              onClick={() => void api.app.openExternal(status.url ?? '')}
            >
              <ExternalLink className="size-3.5" aria-hidden />
            </Button>
          </span>
        ) : (
          <span className="text-xs text-fg-faint">Stopped</span>
        )}
        <ArrowRight className="mt-1 size-3.5 text-fg-faint" aria-hidden />
        <TargetField
          value={config.target}
          fallback={envTarget}
          onSave={(target) => actions.setOptions.mutate({ target })}
        />
        <div className="ml-auto flex items-center gap-2 text-xs text-fg-muted">
          Port
          <NumberField
            label="Port"
            value={config.port}
            min={1}
            max={65_535}
            nullable
            placeholder="auto"
            onSave={(port) => actions.setOptions.mutate({ port })}
          />
          {status.running ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={actions.stop.isPending}
              onClick={() => actions.stop.mutate()}
            >
              <Square className="size-3.5" aria-hidden />
              Stop
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled={actions.start.isPending}
              onClick={() => void start()}
            >
              <Play className="size-3.5" aria-hidden />
              Start
            </Button>
          )}
        </div>
      </div>
      {!status.target && (
        <p className="text-xs text-warn">Set the API address, or add PORT to .env.</p>
      )}
      {status.configChanged && (
        <p className="text-xs text-warn">
          The port or API address changed: stop and start the inspector to use it.
        </p>
      )}
      {startError && (
        <p className="flex items-center gap-2 text-xs text-err">
          {startError.message}
          {startError.nextPort !== null && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const port = startError.nextPort;
                setStartError(null);
                actions.setOptions.mutate({ port }, { onSuccess: () => void start() });
              }}
            >
              Use port {startError.nextPort}
            </Button>
          )}
        </p>
      )}
      <TunnelBar projectId={projectId} status={status} />
      <p className="text-xs text-fg-faint">
        Point your client at the inspector instead of the API. Requests are kept in memory only (the
        last 200).
      </p>
      <div className="grid min-h-80 flex-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex min-h-0 flex-col gap-2 rounded-lg border border-line bg-card p-3">
          <div className="flex items-center gap-2">
            <Input
              aria-label="Filter requests"
              value={filter}
              placeholder="Filter by method, path or status"
              onChange={(e) => setFilter(e.target.value)}
              className="h-7 flex-1 text-xs"
            />
            <Button
              variant="ghost"
              size="sm"
              disabled={entries.length === 0}
              onClick={() => actions.clear.mutate()}
            >
              <Trash2 className="size-3.5" aria-hidden />
              Clear
            </Button>
          </div>
          {shown.length === 0 ? (
            <p className="px-1 text-xs text-fg-muted">
              {entries.length === 0 ? 'No requests yet.' : 'Nothing matches the filter.'}
            </p>
          ) : (
            <ul aria-label="Requests" className="min-h-0 flex-1 overflow-y-auto">
              {shown.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    aria-pressed={selected === e.id}
                    onClick={() => setSelected(e.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded px-2 py-1 text-left font-mono text-[11px] hover:bg-app',
                      selected === e.id && 'bg-brand/15',
                    )}
                  >
                    <span className="w-14 shrink-0 text-fg-faint">{clockTime(e.at)}</span>
                    <span className="w-12 shrink-0 text-brand">{e.method}</span>
                    <span className="min-w-0 flex-1 truncate text-fg">{e.path}</span>
                    {e.tunnel && (
                      <span className="shrink-0 rounded border border-brand/40 px-1 text-[10px] text-brand">
                        tunnel
                      </span>
                    )}
                    {e.replayOf && (
                      <span className="shrink-0 rounded border border-line px-1 text-[10px] text-fg-muted">
                        replay
                      </span>
                    )}
                    <span className={cn('w-12 shrink-0 text-right', statusTone(e.status))}>
                      {e.status ?? e.error}
                    </span>
                    <span className="w-14 shrink-0 text-right text-fg-faint">
                      {e.ms === null ? '' : `${e.ms} ms`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="min-h-0 overflow-y-auto rounded-lg border border-line bg-card p-3">
          {selected ? (
            <EntryDetail projectId={projectId} id={selected} onEdit={setEditing} />
          ) : (
            <p className="text-xs text-fg-muted">Pick a request to see it.</p>
          )}
        </div>
      </div>
      <SendDialog
        detail={editing}
        onClose={() => setEditing(null)}
        onSend={(input) =>
          actions.send.mutate(input, {
            onSuccess: ({ id }) => {
              setEditing(null);
              setSelected(id);
            },
          })
        }
      />
    </section>
  );
}
