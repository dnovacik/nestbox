import { Plug, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NestboxError } from '@shared/errors';
import type { PortRow } from '@shared/ports';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { usePorts } from '@/lib/ports';
import { useProjects } from '@/lib/queries';
import { useUiStore } from '@/state/ui-store';
import { findProjectNode } from '@/app/find-project';
import { usePortKiller } from './use-port-killer';

/** "shop · dev", or "shop · api · dev" for a workspace package. */
export function useOwnerLabel(): (owner: NonNullable<PortRow['owner']>) => string {
  const { data: projects = [] } = useProjects();
  return (owner) => {
    const node = findProjectNode(projects, owner.projectId);
    const project = !node ? 'removed project' : node.isWorkspace ? `${node.summary.name} · ${node.detected.name}` : node.summary.name;
    return `${project} · ${owner.script}`;
  };
}

function matches(row: PortRow, needle: string, ownerLabel: string | null): boolean {
  if (!needle) return true;
  return [String(row.port), row.processName ?? '', row.command ?? '', ownerLabel ?? '', String(row.pid)].some((v) =>
    v.toLowerCase().includes(needle),
  );
}

/** Every listening TCP port on the machine, with the NestBox script that owns it. */
export function PortsPage() {
  const { data, error, isPending } = usePorts();
  const [filter, setFilter] = useState('');
  const [onlyNestbox, setOnlyNestbox] = useState(false);
  const ownerLabel = useOwnerLabel();
  const killer = usePortKiller();
  const ui = useUiStore();

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (data?.rows ?? []).filter(
      (r) => (!onlyNestbox || r.owner !== null) && matches(r, needle, r.owner ? ownerLabel(r.owner) : null),
    );
  }, [data, filter, onlyNestbox, ownerLabel]);

  const openOwner = (owner: NonNullable<PortRow['owner']>) => {
    ui.select(owner.projectId);
    ui.setActiveTab(owner.projectId, 'scripts');
    ui.showScript(owner.projectId, owner.script);
  };

  const unsupported = error instanceof NestboxError && error.code === 'NOT_IMPLEMENTED';

  return (
    <section aria-label="Ports" className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-5 py-3">
        <Plug className="size-4 text-brand" aria-hidden />
        <h1 className="text-sm font-semibold text-fg">Ports</h1>
        <div className="relative ml-4 w-64">
          <Search aria-hidden className="pointer-events-none absolute top-2 left-2 size-3.5 text-fg-muted" />
          <Input
            aria-label="Filter ports"
            placeholder="Port, process or project…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-7 bg-app pl-7 text-xs"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          <Switch aria-label="Only NestBox" checked={onlyNestbox} onCheckedChange={setOnlyNestbox} />
          Only NestBox
        </label>
        {data && (
          <span className="ml-auto text-[11px] text-fg-faint">
            Updated {new Date(data.scannedAt).toLocaleTimeString()}
          </span>
        )}
      </header>
      {data?.stale && (
        <p className="border-b border-warn/30 bg-warn/10 px-5 py-1.5 text-xs text-warn">Couldn't refresh the port list</p>
      )}
      <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
        {unsupported ? (
          <p className="text-sm text-fg-muted">Port listing isn't available on this platform yet.</p>
        ) : error && !data ? (
          <p className="text-sm text-err">Couldn't list the ports. Retrying…</p>
        ) : isPending ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : (
          <table aria-label="Listening ports" className="w-full table-fixed text-left text-xs">
            <thead className="text-[10px] tracking-wider text-fg-muted uppercase">
              <tr>
                <th className="w-20 py-1.5 font-semibold">Port</th>
                <th className="w-40 py-1.5 font-semibold">Address</th>
                <th className="w-36 py-1.5 font-semibold">Process</th>
                <th className="w-20 py-1.5 font-semibold">PID</th>
                <th className="w-48 py-1.5 font-semibold">Owner</th>
                <th className="py-1.5 font-semibold">Command</th>
                <th className="w-16 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.port}:${r.pid}`} className="border-t border-line">
                  <td className="py-1.5 font-mono text-fg">{r.port}</td>
                  <td className="truncate py-1.5 font-mono text-fg-muted">{r.addresses.join(', ')}</td>
                  <td className="truncate py-1.5 text-fg">{r.processName ?? '—'}</td>
                  <td className="py-1.5 font-mono text-fg-muted">{r.pid}</td>
                  <td className="truncate py-1.5">
                    {r.owner ? (
                      <button type="button" className="truncate text-brand hover:underline" onClick={() => r.owner && openOwner(r.owner)}>
                        {ownerLabel(r.owner)}
                      </button>
                    ) : (
                      <span className="text-fg-faint">—</span>
                    )}
                  </td>
                  <td className="truncate py-1.5 font-mono text-fg-muted" title={r.command ?? undefined}>
                    {r.command ?? '—'}
                  </td>
                  <td className="py-1.5 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Kill port ${r.port}`}
                      disabled={killer.isPending}
                      onClick={() => void killer.kill({ pid: r.pid, port: r.port })}
                    >
                      <X className="text-err" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && rows.length === 0 && (
          <p className="py-3 text-xs text-fg-faint">{data.rows.length === 0 ? 'Nothing is listening' : 'No ports match the filter'}</p>
        )}
      </div>
      {killer.dialog}
    </section>
  );
}
