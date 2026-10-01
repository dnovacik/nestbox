import { Button } from '@/components/ui/button';
import { useUiStore } from '@/state/ui-store';
import type { ToolPanelProps } from '../types';
import { useEnvMatrix } from './use-env';

export function EnvCard({ projectId }: ToolPanelProps) {
  const { data } = useEnvMatrix(projectId);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const flagged = data?.keys.filter((k) => k.missing || k.undocumented).length ?? 0;
  const active = data?.profiles.find((p) => p.active)?.name ?? null;
  return (
    <section aria-label="Env" className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4">
      <h3 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">Env</h3>
      {data && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-fg-muted">Files</dt>
          <dd className="text-fg">{data.files.length === 0 ? 'none' : data.files.length}</dd>
          <dt className="text-fg-muted">Flagged keys</dt>
          <dd className={flagged > 0 ? 'text-warn' : 'text-fg'}>{flagged}</dd>
          {data.profiles.length > 0 && (
            <>
              <dt className="text-fg-muted">Profile</dt>
              <dd className="font-mono text-fg">{active ?? 'none active'}</dd>
            </>
          )}
        </dl>
      )}
      <Button variant="secondary" size="sm" className="self-start" onClick={() => setActiveTab(projectId, 'env')}>
        Open Env
      </Button>
    </section>
  );
}
