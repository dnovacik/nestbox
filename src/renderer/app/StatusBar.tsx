import { Cpu, MemoryStick, TriangleAlert } from 'lucide-react';
import { useProcesses, useSettings, useSystemStats } from '@/lib/queries';

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 ** 2);
  return `${mb.toFixed(0)} MB`;
}

export function StatusBar({ projectCount }: { projectCount: number }) {
  const { data: processes = [] } = useProcesses();
  const { data: settings } = useSettings();
  const { data: stats } = useSystemStats();
  const running = processes.filter((p) => p.state === 'starting' || p.state === 'running').length;

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-line bg-card px-4 font-mono text-[11px] text-fg-muted">
      <div className="flex items-center gap-4">
        <span>
          {projectCount} {projectCount === 1 ? 'project' : 'projects'}
        </span>
        {running > 0 && <span>{running} running</span>}
      </div>
      <div className="flex items-center gap-4">
        {stats && (
          <>
            <span className="flex items-center gap-1.5">
              <Cpu className="size-3" aria-hidden />
              <span>{stats.cpuPercent.toFixed(1)}%</span>
            </span>
            <span className="flex items-center gap-1.5">
              <MemoryStick className="size-3" aria-hidden />
              <span>{formatBytes(stats.memoryUsed)} / {formatBytes(stats.memoryTotal)}</span>
            </span>
          </>
        )}
        {settings?.readOnly && (
          <span className="flex items-center gap-1 text-warn">
            <TriangleAlert aria-hidden className="size-3" />
            Settings are read-only
          </span>
        )}
      </div>
    </footer>
  );
}
