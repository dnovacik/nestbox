import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useUiStore } from '@/state/ui-store';
import type { ToolPanelProps } from '../types';
import { useStaticStatus } from './use-static';

export function StaticCard({ projectId }: ToolPanelProps) {
  const { data } = useStaticStatus(projectId);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  return (
    <section aria-label="Static" className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4">
      <h3 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">Static</h3>
      {data && (data.running && data.localUrl ? (
        <a
          href={data.localUrl}
          className="font-mono text-xs text-brand hover:underline"
          onClick={(e) => {
            e.preventDefault();
            if (data.localUrl) void api.app.openExternal(data.localUrl);
          }}
        >
          {data.localUrl}
        </a>
      ) : (
        <p className="text-xs text-fg-faint">Not serving.</p>
      ))}
      <Button variant="secondary" size="sm" className="self-start" onClick={() => setActiveTab(projectId, 'static')}>
        Open Static
      </Button>
    </section>
  );
}
