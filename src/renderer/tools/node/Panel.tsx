import { RefreshCw } from 'lucide-react';
import { SOURCE_LABELS } from '@shared/tools/node/contract';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { ToolPanelProps } from '../types';
import { managerHint, STATE_LABEL, STATE_TONE } from './labels';
import { useNodeActions, useNodeStatus } from './use-node';

const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Which Node a package needs, where that comes from, and what will really run its scripts. */
export default function NodePanel({ projectId }: ToolPanelProps) {
  const { data: status, isError } = useNodeStatus(projectId);
  const { refresh, setFnm } = useNodeActions(projectId);
  if (isError) return <p className="text-sm text-fg-muted">Couldn't check the Node version.</p>;
  if (!status) return <p className="text-sm text-fg-muted">Checking…</p>;
  const pm = status.packageManager;
  return (
    <section aria-label="Node" className="flex max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-fg">Node</h2>
        <span className="flex items-center gap-2 text-xs text-fg-muted">
          <span aria-hidden className={cn('size-2 rounded-full', STATE_TONE[status.state])} />
          {STATE_LABEL[status.state]}
        </span>
        <span className="ml-auto text-[11px] text-fg-faint">checked {time(status.checkedAt)}</span>
        <Button
          variant="secondary"
          size="sm"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          <RefreshCw className="size-3.5" aria-hidden />
          Refresh
        </Button>
      </div>

      <div className="rounded-lg border border-line bg-card p-4">
        <h3 className="mb-2 text-[10px] font-semibold tracking-wider text-fg-muted uppercase">
          Required version
        </h3>
        {status.sources.length === 0 ? (
          <p className="text-xs text-fg-muted">
            No .nvmrc, .node-version, engines.node or volta.node in this package or its root.
          </p>
        ) : (
          <ul aria-label="Sources" className="space-y-1">
            {status.sources.map((s) => (
              <li key={s.kind} className="flex items-center gap-3 text-xs">
                <span className="w-28 shrink-0 font-mono text-fg-muted">
                  {SOURCE_LABELS[s.kind]}
                </span>
                <span className="min-w-0 truncate font-mono text-fg">{s.value ?? '—'}</span>
                {s.fromRoot && <span className="text-[11px] text-fg-faint">from the root</span>}
                {s.kind === status.requirement && (
                  <span className="rounded border border-brand/40 px-1 text-[10px] text-brand">
                    used
                  </span>
                )}
                {s.conflict && (
                  <span className="rounded border border-warn/40 px-1 text-[10px] text-warn">
                    disagrees
                  </span>
                )}
                {!s.valid && (
                  <span className="rounded border border-err/40 px-1 text-[10px] text-err">
                    unreadable
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-line bg-card p-4 text-xs">
        <h3 className="mb-2 text-[10px] font-semibold tracking-wider text-fg-muted uppercase">
          What runs the scripts
        </h3>
        <p className="flex items-center gap-3">
          <span className="w-28 shrink-0 text-fg-muted">Node</span>
          <span className={cn('font-mono', status.node.ok === false ? 'text-err' : 'text-fg')}>
            {status.node.version ?? 'not found'}
          </span>
          {status.fnm.on && <span className="text-fg-faint">through fnm</span>}
          {status.node.ok === null && status.node.version !== null && (
            <span className="text-fg-faint">not compared (no resolvable requirement)</span>
          )}
        </p>
        {pm && (
          <p className="mt-1 flex items-center gap-3">
            <span className="w-28 shrink-0 text-fg-muted">{pm.name}</span>
            <span className={cn('font-mono', pm.ok === false ? 'text-err' : 'text-fg')}>
              {pm.installed ?? 'unknown'}
            </span>
            <span className="text-fg-faint">
              packageManager {pm.name}@{pm.version}
              {pm.detected !== null &&
                pm.detected !== pm.name &&
                `, but the lockfile is ${pm.detected}'s`}
              {pm.installed === null && ' (not installed, or Corepack has no copy offline)'}
            </span>
          </p>
        )}
      </div>

      <div className="rounded-lg border border-line bg-card p-4 text-xs">
        <h3 className="mb-2 text-[10px] font-semibold tracking-wider text-fg-muted uppercase">
          Version manager
        </h3>
        <p className="text-fg-muted">{managerHint(status.manager)}</p>
        {status.manager === 'fnm' &&
          (status.fnm.available ? (
            <label className="mt-3 flex items-center gap-3 text-fg">
              <Switch
                aria-label="Run scripts with fnm"
                checked={status.fnm.on}
                disabled={setFnm.isPending}
                onCheckedChange={(enabled) => setFnm.mutate(enabled)}
              />
              Run this project's scripts with fnm using Node {status.fnm.version}
            </label>
          ) : (
            <p className="mt-2 text-fg-faint">The requirement gives fnm no version to use.</p>
          ))}
      </div>
    </section>
  );
}
