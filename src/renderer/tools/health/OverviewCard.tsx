import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/state/ui-store';
import type { ToolPanelProps } from '../types';
import { checkTone, DOT_CLASS, TONE_LABEL } from './labels';
import { useHealth, useHealthActions } from './use-health';

export function HealthCard({ projectId }: ToolPanelProps) {
  const { data: status, isError } = useHealth(projectId);
  const { add } = useHealthActions(projectId);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const port = status?.suggestions.port ?? null;
  return (
    <section
      aria-label="Health"
      className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">Health</h3>
        {status && (
          <span className={cn('text-[11px]', status.live ? 'text-ok' : 'text-fg-faint')}>
            {status.live ? 'Running' : 'Idle (no scripts running)'}
          </span>
        )}
      </div>
      {isError && <p className="text-xs text-fg-muted">Couldn't read the health checks.</p>}
      {status && status.checks.length === 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-fg-muted">No checks</span>
          {port !== null && (
            <Button
              variant="secondary"
              size="sm"
              disabled={add.isPending}
              onClick={() => add.mutate({ kind: 'url', url: `http://localhost:${port}/` })}
            >
              <Plus className="size-3.5" aria-hidden />
              Add localhost:{port}
            </Button>
          )}
        </div>
      )}
      {status && status.checks.length > 0 && (
        <ul className="space-y-1.5 text-xs">
          {status.checks.map((check) => {
            const tone = checkTone(check.result);
            const detail =
              check.result?.state === 'ok' && check.result.ms !== null
                ? `${check.result.ms} ms`
                : (check.result?.reason ?? '');
            return (
              <li key={check.id} className="flex items-center gap-2">
                <span
                  title={TONE_LABEL[tone]}
                  className={cn('size-2 shrink-0 rounded-full', DOT_CLASS[tone])}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-fg">{check.label}</span>
                <span className="shrink-0 text-fg-faint">{detail}</span>
              </li>
            );
          })}
        </ul>
      )}
      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        onClick={() => setActiveTab(projectId, 'health')}
      >
        Open Health
      </Button>
    </section>
  );
}
