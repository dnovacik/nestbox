import { splitProjectId } from '@shared/detected';
import type { PortRow } from '@shared/ports';
import { Button } from '@/components/ui/button';
import { portsForProject, usePorts } from '@/lib/ports';
import { useSettings } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useEnvFacts } from '@/tools/env/use-env';
import { useUiStore } from '@/state/ui-store';

/** The owner's script, prefixed by its package path when it is a workspace package of this project. */
function scriptLabel(owner: NonNullable<PortRow['owner']>, projectId: string): string {
  return owner.projectId === projectId ? owner.script : `${splitProjectId(owner.projectId).relPath} · ${owner.script}`;
}

/** Overview card: the ports this project's scripts listen on, and the watched ports (free or used by what). */
export function PortsCard({ projectId }: { projectId: string }) {
  const { data } = usePorts();
  const { data: settings } = useSettings();
  const showPorts = useUiStore((s) => s.showPorts);
  const rows = data?.rows ?? [];
  const own = portsForProject(rows, projectId);
  const watched = settings?.watchedPorts ?? [];
  const { data: facts } = useEnvFacts(projectId);
  const envPort = facts?.port ?? null;
  const envPortUser = envPort === null ? null : (rows.find((r) => r.port === envPort) ?? null);

  return (
    <section aria-label="Ports" className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4">
      <h3 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">Ports</h3>
      {data && own.length === 0 && <p className="text-xs text-fg-faint">No ports open by this project.</p>}
      {own.length > 0 && (
        <ul aria-label="Ports of this project" className="space-y-1 text-xs">
          {own.map((r) => (
            <li key={`${r.port}:${r.pid}`} className="flex items-center gap-2">
              <span className="font-mono text-fg">{r.port}</span>
              <span className="truncate font-mono text-fg-muted">{r.owner && scriptLabel(r.owner, projectId)}</span>
            </li>
          ))}
        </ul>
      )}
      {watched.length > 0 && (
        <ul aria-label="Watched ports" className="flex flex-wrap gap-1.5">
          {watched.map((port) => {
            const user = rows.find((r) => r.port === port);
            const label = !user ? 'free' : user.owner ? user.owner.script : (user.processName ?? `PID ${user.pid}`);
            return (
              <li
                key={port}
                title={user ? `${port} is used by ${label}` : `${port} is free`}
                className={cn(
                  'flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px]',
                  user ? 'border-brand/40 bg-brand/10 text-fg' : 'border-line text-fg-faint',
                )}
              >
                <span>{port}</span>
                <span className={user ? 'text-fg-muted' : undefined}>{label}</span>
              </li>
            );
          })}
        </ul>
      )}
      {envPort !== null && (
        <p className="text-xs text-fg-muted">
          <span className="font-mono text-fg">PORT {envPort}</span> from .env:{' '}
          {envPortUser
            ? `used by ${envPortUser.owner ? scriptLabel(envPortUser.owner, projectId) : (envPortUser.processName ?? `PID ${envPortUser.pid}`)}`
            : 'free'}
        </p>
      )}
      <Button variant="secondary" size="sm" className="self-start" onClick={showPorts}>
        Open Ports
      </Button>
    </section>
  );
}
