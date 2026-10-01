import { TriangleAlert } from 'lucide-react';
import { useProcesses, useSettings } from '@/lib/queries';

export function StatusBar({ projectCount }: { projectCount: number }) {
  const { data: processes = [] } = useProcesses();
  const { data: settings } = useSettings();
  const running = processes.filter((p) => p.state === 'starting' || p.state === 'running').length;
  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-line bg-card px-4 font-mono text-[11px] text-fg-muted">
      <div className="flex items-center gap-4">
        <span>
          {projectCount} {projectCount === 1 ? 'project' : 'projects'}
        </span>
        {running > 0 && <span>{running} running</span>}
      </div>
      {settings?.readOnly && (
        <span className="flex items-center gap-1 text-warn">
          <TriangleAlert aria-hidden className="size-3" />
          Settings are read-only
        </span>
      )}
    </footer>
  );
}
