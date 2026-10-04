import { Loader2 } from 'lucide-react';
import { PLATFORM_LABELS, type PlatformStatus } from '@shared/tools/deploy/contract';
import { Button } from '@/components/ui/button';
import { relativeTime } from '@/lib/relative-time';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/state/ui-store';
import type { ToolPanelProps } from '../types';
import { useDeployStatus } from './use-deploy';

function platformLine(p: PlatformStatus): string {
  if (p.cli === 'missing') return 'CLI not installed';
  if (!p.linked) return 'not linked';
  return p.name ?? 'linked';
}

/** Local facts only: the card never lists deployments (that runs the CLI). */
export function DeployCard({ projectId }: ToolPanelProps) {
  const { data: status, isError } = useDeployStatus(projectId);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  return (
    <section
      aria-label="Deploy"
      className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4"
    >
      <h3 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">Deploy</h3>
      {isError && <p className="text-xs text-fg-muted">Couldn't read the deploy settings.</p>}
      {status && (
        <ul className="space-y-1 text-xs">
          {status.platforms.map((p) => (
            <li key={p.platform} className="flex items-center gap-2">
              <span className="w-20 text-fg">{PLATFORM_LABELS[p.platform]}</span>
              <span
                className={cn(
                  'truncate font-mono',
                  p.cli !== 'missing' && p.linked ? 'text-fg-muted' : 'text-warn',
                )}
              >
                {platformLine(p)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {status?.action && (
        <p className="flex items-center gap-1.5 text-xs text-brand">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          Deploying {status.action.target} to {PLATFORM_LABELS[status.action.platform]}…
        </p>
      )}
      {status && !status.action && status.last && (
        <p className={cn('text-xs', status.last.ok ? 'text-fg-muted' : 'text-err')}>
          {status.last.ok ? 'Last deploy' : 'Last deploy failed'}: {status.last.target} to{' '}
          {PLATFORM_LABELS[status.last.platform]}, {relativeTime(status.last.at)}
        </p>
      )}
      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        onClick={() => setActiveTab(projectId, 'deploy')}
      >
        Open Deploy
      </Button>
    </section>
  );
}
