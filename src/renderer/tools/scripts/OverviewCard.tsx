import { aggregateState, belongsTo, isLive } from '@shared/processes';
import { WORKSPACE_ID_SEPARATOR } from '@shared/detected';
import { StateDot } from '@/components/StateDot';
import { Button } from '@/components/ui/button';
import { useProcesses } from '@/lib/queries';
import { useUiStore } from '@/state/ui-store';
import type { ToolPanelProps } from '../types';

export function ScriptsCard({ projectId }: ToolPanelProps) {
  const { data: processes = [] } = useProcesses();
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const shown = processes.filter((p) => belongsTo(p.projectId, projectId) && (isLive(p.state) || p.state === 'crashed'));

  return (
    <section aria-label="Scripts" className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4">
      <h3 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">Scripts</h3>
      {shown.length === 0 ? (
        <p className="text-xs text-fg-faint">No scripts running.</p>
      ) : (
        <ul className="space-y-1.5 text-xs">
          {shown.map((p) => (
            <li key={`${p.projectId}/${p.script}`} className="flex items-center gap-2">
              <StateDot state={aggregateState([p.state])} />
              <span className="truncate font-mono text-fg">
                {p.projectId === projectId ? p.script : `${p.projectId.split(WORKSPACE_ID_SEPARATOR)[1] ?? ''} · ${p.script}`}
              </span>
              <span className="ml-auto text-fg-muted">{p.state}</span>
            </li>
          ))}
        </ul>
      )}
      <Button variant="secondary" size="sm" className="self-start" onClick={() => setActiveTab(projectId, 'scripts')}>
        Open Scripts
      </Button>
    </section>
  );
}
