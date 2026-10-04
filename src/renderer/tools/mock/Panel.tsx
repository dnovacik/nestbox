import {
  ArrowDown,
  ArrowUp,
  Copy,
  ExternalLink,
  Pencil,
  Play,
  Plus,
  Square,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { NestboxError } from '@shared/errors';
import {
  MAX_DELAY_MS,
  MAX_ROUTES,
  type MockRoute,
  type PackageMock,
} from '@shared/tools/mock/contract';
import { LogView } from '@/components/log/LogView';
import { NumberField } from '@/components/NumberField';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import type { ToolPanelProps } from '../types';
import { RouteEditor } from './RouteEditor';
import { mockLogSource, useMock, useMockActions } from './use-mock';

const routeLabel = (r: MockRoute) => `${r.method} ${r.path}`;

function RouteRow({
  route,
  index,
  count,
  projectId,
  onEdit,
  onDuplicate,
}: {
  route: MockRoute;
  index: number;
  count: number;
  projectId: string;
  onEdit(): void;
  onDuplicate(): void;
}) {
  const { saveRoute, deleteRoute, moveRoute } = useMockActions(projectId);
  const label = routeLabel(route);
  return (
    <li className={cn('flex items-center gap-3 px-4 py-2 text-xs', !route.enabled && 'opacity-60')}>
      <Switch
        aria-label={`Enable ${label}`}
        checked={route.enabled}
        onCheckedChange={(enabled) => saveRoute.mutate({ ...route, enabled })}
      />
      <span className="w-14 shrink-0 font-mono text-[11px] text-brand">{route.method}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-fg">{route.path}</span>
      <span className="w-10 shrink-0 font-mono text-fg-muted">{route.status}</span>
      <span className="w-16 shrink-0 text-fg-faint">
        {route.delayMs > 0 ? `+${route.delayMs} ms` : ''}
      </span>
      <label className="flex shrink-0 items-center gap-1.5 text-fg-muted">
        <Switch
          aria-label={`Fail ${label}`}
          checked={route.fail.on}
          onCheckedChange={(on) => saveRoute.mutate({ ...route, fail: { ...route.fail, on } })}
        />
        <span className={route.fail.on ? 'text-err' : undefined}>fail {route.fail.status}</span>
      </label>
      <div className="flex shrink-0 items-center">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={`Move ${label} up`}
          disabled={index === 0}
          onClick={() => moveRoute.mutate({ id: route.id, to: index - 1 })}
        >
          <ArrowUp className="size-3.5" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={`Move ${label} down`}
          disabled={index === count - 1}
          onClick={() => moveRoute.mutate({ id: route.id, to: index + 1 })}
        >
          <ArrowDown className="size-3.5" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={`Edit ${label}`}
          onClick={onEdit}
        >
          <Pencil className="size-3.5" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={`Duplicate ${label}`}
          disabled={count >= MAX_ROUTES}
          onClick={onDuplicate}
        >
          <Copy className="size-3.5" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={`Delete ${label}`}
          onClick={() => deleteRoute.mutate(route.id)}
        >
          <Trash2 className="size-3.5" aria-hidden />
        </Button>
      </div>
    </li>
  );
}

function Toggles({ config, projectId }: { config: PackageMock; projectId: string }) {
  const { setOptions } = useMockActions(projectId);
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-card px-4 py-3 text-xs text-fg-muted">
      <label className="flex items-center gap-2">
        Extra delay on every request
        <NumberField
          label="Extra delay (ms)"
          value={config.delayMs}
          min={0}
          max={MAX_DELAY_MS}
          onSave={(v) => setOptions.mutate({ delayMs: v ?? 0 })}
        />
        ms
      </label>
      <label className="flex items-center gap-2">
        <Switch
          aria-label="Fail every request"
          checked={config.failAll.on}
          onCheckedChange={(on) => setOptions.mutate({ failAll: { ...config.failAll, on } })}
        />
        <span className={config.failAll.on ? 'text-err' : undefined}>Fail every request with</span>
        <NumberField
          label="Fail-all status"
          value={config.failAll.status}
          min={100}
          max={599}
          onSave={(v) => setOptions.mutate({ failAll: { ...config.failAll, status: v ?? 500 } })}
        />
      </label>
    </div>
  );
}

/** Routes defined here, served on a local port, with delays, failure switches and a request log. */
export default function MockPanel({ projectId }: ToolPanelProps) {
  const { status, config, isError } = useMock(projectId);
  const actions = useMockActions(projectId);
  const [editing, setEditing] = useState<{ route: MockRoute | null } | null>(null);
  const [startError, setStartError] = useState<{ message: string; nextPort: number | null } | null>(
    null,
  );
  const source = useMemo(() => mockLogSource(projectId), [projectId]);

  if (isError) return <p className="text-sm text-fg-muted">Couldn't read the mock API.</p>;
  if (!status || !config) return <p className="text-sm text-fg-muted">Loading…</p>;

  const start = async () => {
    setStartError(null);
    try {
      await actions.start.mutateAsync();
    } catch (error) {
      const busy = error instanceof NestboxError && error.code === 'CONFLICT';
      const next = busy
        ? await api.tools.invoke('mock', projectId, 'nextFreePort', {}).catch(() => null)
        : null;
      setStartError({ message: errorMessage(error), nextPort: next?.port ?? null });
    }
  };

  const duplicate = (route: MockRoute) =>
    actions.saveRoute.mutate({ ...route, id: crypto.randomUUID() });

  return (
    <section aria-label="Mock API" className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-fg">Mock API</h2>
        {status.url ? (
          <>
            <span className="font-mono text-xs text-fg select-text">{status.url}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void api.app.openExternal(status.url ?? '')}
            >
              <ExternalLink className="size-3.5" aria-hidden />
              Open
            </Button>
          </>
        ) : (
          <span className="text-xs text-fg-faint">Stopped</span>
        )}
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
      {status.configChanged && (
        <p className="text-xs text-warn">The port changed: stop and start the server to use it.</p>
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
      <Toggles config={config} projectId={projectId} />
      <div className="flex items-center gap-2">
        <h3 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">Routes</h3>
        <span className="text-xs text-fg-faint">first match wins</span>
        <Button
          variant="secondary"
          size="sm"
          className="ml-auto"
          disabled={config.routes.length >= MAX_ROUTES}
          onClick={() => setEditing({ route: null })}
        >
          <Plus className="size-3.5" aria-hidden />
          Add route
        </Button>
      </div>
      {config.routes.length === 0 ? (
        <p className="text-xs text-fg-muted">No routes yet. Unmatched requests get a 404.</p>
      ) : (
        <ul
          aria-label="Routes"
          className="divide-y divide-line rounded-lg border border-line bg-card"
        >
          {config.routes.map((route, index) => (
            <RouteRow
              key={route.id}
              route={route}
              index={index}
              count={config.routes.length}
              projectId={projectId}
              onEdit={() => setEditing({ route })}
              onDuplicate={() => duplicate(route)}
            />
          ))}
        </ul>
      )}
      <div className="flex min-h-64 flex-1 flex-col">
        <LogView
          source={source}
          name="Requests"
          emptyHint="Start the server and send it a request."
        />
      </div>
      <RouteEditor
        open={editing !== null}
        route={editing?.route ?? null}
        onClose={() => setEditing(null)}
        onSave={(route) => actions.saveRoute.mutate(route, { onSuccess: () => setEditing(null) })}
      />
    </section>
  );
}
