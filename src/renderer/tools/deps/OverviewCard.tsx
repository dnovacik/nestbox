import { summarize } from '@shared/tools/deps/contract';
import { Button } from '@/components/ui/button';
import { relativeTime } from '@/lib/relative-time';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/state/ui-store';
import type { ToolPanelProps } from '../types';
import { useDepsActions, useDepsResults } from './use-deps';

export function DepsCard({ projectId }: ToolPanelProps) {
  const { data, isError } = useDepsResults(projectId);
  const { check } = useDepsActions(projectId);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const checking = data?.checking === true || check.isPending;
  const s = data ? summarize(data.packages) : null;
  return (
    <section
      aria-label="Dependencies"
      aria-busy={!data && !isError}
      className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4"
    >
      <h3 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">
        Dependencies
      </h3>
      {isError && <p className="text-xs text-fg-muted">Couldn't read the last check.</p>}
      {s && (
        <div className="space-y-1.5 text-xs">
          {s.checkedAt === null ? (
            <p className="text-fg-muted">Not checked yet.</p>
          ) : (
            <>
              <p className="text-fg">
                {s.outdated} outdated
                {s.major > 0 && <span className="text-warn"> ({s.major} major)</span>}
                {' · '}
                <span
                  className={cn(
                    s.critical + s.high > 0
                      ? 'text-err'
                      : s.vulnerable > 0
                        ? 'text-warn'
                        : 'text-fg',
                  )}
                >
                  {s.vulnerable} vulnerable
                  {s.critical + s.high > 0 &&
                    ` (${s.critical > 0 ? `${s.critical} critical, ` : ''}${s.high} high)`}
                </span>
              </p>
              <p className="text-fg-faint">
                checked {relativeTime(s.checkedAt)}
                {s.errors > 0 && (
                  <span className="text-warn">
                    {' '}
                    · {s.errors} step{s.errors === 1 ? '' : 's'} failed
                  </span>
                )}
              </p>
            </>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={!data || checking}
          onClick={() => check.mutate()}
        >
          {checking ? 'Checking…' : 'Check'}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setActiveTab(projectId, 'deps')}>
          Open Dependencies
        </Button>
      </div>
    </section>
  );
}
