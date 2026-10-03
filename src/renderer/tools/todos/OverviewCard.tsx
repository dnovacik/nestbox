import { Button } from '@/components/ui/button';
import { relativeTime } from '@/lib/relative-time';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/state/ui-store';
import type { ToolPanelProps } from '../types';
import { TRUNCATED_TEXT, tagCounts, tagTone } from './labels';
import { useTodos } from './use-todos';

export function TodosCard({ projectId }: ToolPanelProps) {
  const { result, scanning, isError } = useTodos(projectId);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  return (
    <section aria-label="TODOs" aria-busy={scanning} className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4">
      <h3 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">TODOs</h3>
      {isError && <p className="text-xs text-fg-muted">Couldn't read the TODOs.</p>}
      {!result && scanning && <p className="text-xs text-fg-muted">Scanning…</p>}
      {result && (
        <div className="space-y-1.5 text-xs">
          <p className="text-fg">
            {result.todos.length === 0 ? 'None found' : `${result.todos.length.toLocaleString('en-US')}${result.truncated === 'matches' ? '+' : ''} in ${new Set(result.todos.map((t) => t.path)).size} files`}
          </p>
          {result.todos.length > 0 && (
            <p className="flex flex-wrap gap-1.5">
              {tagCounts(result.todos).map(([tag, n]) => (
                <span key={tag} className={cn('rounded border px-1.5 font-mono text-[10px]', tagTone(tag))}>
                  {tag} {n}
                </span>
              ))}
            </p>
          )}
          <p className="text-fg-faint">
            {scanning ? 'Scanning…' : `scanned ${relativeTime(result.scannedAt)}`}
            {result.truncated && ` · ${TRUNCATED_TEXT[result.truncated]}`}
          </p>
        </div>
      )}
      <Button variant="secondary" size="sm" className="self-start" onClick={() => setActiveTab(projectId, 'todos')}>
        Open TODOs
      </Button>
    </section>
  );
}
