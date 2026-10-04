import { Play, RotateCw, Square } from 'lucide-react';
import { isLive, type ProcessSummary } from '@shared/processes';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useProcesses } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/state/ui-store';
import type { ScriptInfo } from '@shared/tools/scripts/contract';
import { useScriptAction, useScriptList, useSetAutoRestart } from './use-scripts';

const BADGES: Partial<Record<ProcessSummary['state'], string>> = {
  starting: 'border-warn/30 bg-warn/10 text-warn',
  stopping: 'border-warn/30 bg-warn/10 text-warn',
  running: 'border-ok/30 bg-ok/10 text-ok',
  crashed: 'border-err/30 bg-err/10 text-err',
  exited: 'border-line bg-surface text-fg-muted',
};

function crashText(p: ProcessSummary): string | null {
  if (p.state !== 'crashed' || !p.exit) return null;
  const how = p.exit.code !== null ? `exit ${p.exit.code}` : p.exit.signal ? `killed by ${p.exit.signal}` : 'could not start';
  return p.exit.lastLine ? `${how} · ${p.exit.lastLine}` : how;
}

function ScriptRow({ projectId, info, process }: { projectId: string; info: ScriptInfo; process: ProcessSummary | undefined }) {
  const action = useScriptAction(projectId);
  const setAutoRestart = useSetAutoRestart(projectId);
  const showScript = useUiStore((s) => s.showScript);
  const live = process !== undefined && isLive(process.state);
  const badge = process ? BADGES[process.state] : undefined;
  const crash = process ? crashText(process) : null;
  const busy = action.isPending && action.variables?.script === info.name;

  return (
    <li className="rounded-md border border-line bg-card px-3 py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => showScript(projectId, info.name)}
          className="min-w-0 truncate font-mono text-xs font-semibold text-fg hover:text-brand"
          title="Show output"
        >
          {info.name}
        </button>
        {process && badge && (
          <span className={cn('rounded border px-1.5 py-px text-[10px] font-medium', badge)}>
            {process.state === 'exited' ? `exited ${process.exit?.code ?? ''}`.trim() : process.state}
          </span>
        )}
        {process?.warning && (
          <span
            title={process.warning}
            aria-label={`Version warning: ${process.warning}`}
            className="rounded border border-warn/40 px-1.5 py-px text-[10px] font-medium text-warn"
          >
            Node
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {live ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Stop ${info.name}`}
                disabled={busy || process.state === 'stopping'}
                onClick={() => action.mutate({ action: 'stop', script: info.name })}
              >
                <Square className="text-err" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Restart ${info.name}`}
                disabled={busy || process.state === 'stopping'}
                onClick={() => action.mutate({ action: 'restart', script: info.name })}
              >
                <RotateCw />
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Start ${info.name}`}
              disabled={busy}
              onClick={() => {
                showScript(projectId, info.name);
                action.mutate({ action: 'start', script: info.name });
              }}
            >
              <Play className="text-ok" />
            </Button>
          )}
        </div>
      </div>
      <p className="mt-0.5 truncate font-mono text-[11px] text-fg-muted" title={info.command}>
        {info.command}
      </p>
      {crash && <p className="mt-1 truncate font-mono text-[11px] text-err" title={crash}>{crash}</p>}
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-fg-muted">
        <Switch
          aria-label={`Auto-restart ${info.name}`}
          checked={info.autoRestart}
          disabled={setAutoRestart.isPending}
          onCheckedChange={(enabled) => setAutoRestart.mutate({ script: info.name, enabled })}
          className="scale-75"
        />
        <span>Auto-restart</span>
        {process && process.crashCount > 0 && (
          <span className="text-err">
            {process.crashCount} {process.crashCount === 1 ? 'crash' : 'crashes'}
          </span>
        )}
        {process?.nextRestartAt != null && <span className="text-warn">restarting…</span>}
        {process?.gaveUp && <span className="text-err">gave up after {process.crashCount} crashes</span>}
      </div>
    </li>
  );
}

export function ScriptList({ projectId }: { projectId: string }) {
  const { data, isPending, isError } = useScriptList(projectId);
  const { data: processes = [] } = useProcesses();
  if (isPending) return <p className="text-xs text-fg-muted">Loading scripts…</p>;
  if (isError || !data) return <p className="text-xs text-err">Couldn't load the scripts.</p>;
  if (data.scripts.length === 0) return <p className="text-xs text-fg-faint">No scripts in package.json.</p>;
  return (
    <section aria-label="Scripts">
      <h3 className="mb-2 text-[10px] font-semibold tracking-wider text-fg-muted uppercase">Scripts</h3>
      <ul className="space-y-1.5">
        {data.scripts.map((info) => (
          <ScriptRow
            key={info.name}
            projectId={projectId}
            info={info}
            process={processes.find((p) => p.projectId === projectId && p.script === info.name)}
          />
        ))}
      </ul>
    </section>
  );
}
