import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/state/ui-store';
import type { ToolPanelProps } from '../types';
import { requirementText, STATE_LABEL, STATE_TONE } from './labels';
import { useNodeStatus } from './use-node';

export function NodeCard({ projectId }: ToolPanelProps) {
  const { data, isError } = useNodeStatus(projectId);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const required = data ? requirementText(data) : null;
  const pm = data?.packageManager ?? null;
  return (
    <section
      aria-label="Node"
      aria-busy={!data && !isError}
      className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4"
    >
      <h3 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">Node</h3>
      {isError && <p className="text-xs text-fg-muted">Couldn't check the Node version.</p>}
      {data && (
        <div className="space-y-1.5 text-xs">
          <p className="flex items-center gap-2 text-fg">
            <span aria-hidden className={cn('size-2 rounded-full', STATE_TONE[data.state])} />
            {STATE_LABEL[data.state]}
          </p>
          <p className="text-fg-muted">
            {required ? `Needs ${required}` : 'No required version'}
            {' · '}
            <span className={cn('font-mono', data.node.ok === false && 'text-err')}>
              {data.node.version ?? 'Node not found'}
            </span>
          </p>
          {pm && (
            <p className="text-fg-muted">
              <span className="font-mono">
                {pm.name}@{pm.version}
              </span>
              {' · '}
              <span className={cn('font-mono', pm.ok === false && 'text-err')}>
                {pm.detected !== null && pm.detected !== pm.name
                  ? `lockfile is ${pm.detected}'s`
                  : pm.installed === null
                    ? 'installed version unknown'
                    : `installed ${pm.installed}`}
              </span>
            </p>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={() => setActiveTab(projectId, 'node')}>
          Open Node
        </Button>
      </div>
    </section>
  );
}
