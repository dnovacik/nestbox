import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { MAX_EXPORT_SEQS } from '@shared/tools/scripts/contract';
import { cn } from '@/lib/utils';
import { contextsOf, type LogFilters, NO_FILTERS, searchHits, structuredFilterActive, visibleLines } from './filters';
import type { LinkMatch } from './links';
import { LogRow } from './LogRow';
import { LogToolbar } from './LogToolbar';
import { useExportLogs, useOpenFileAt } from './use-scripts';
import { useLogStream } from './use-log-stream';

export interface LogPaneProps {
  projectId: string;
  script: string | null;
  scripts: string[];
  onScriptChange(script: string): void;
  /** The pane that clicks in the script list fill. */
  active: boolean;
  onActivate(): void;
}

const ROW_HEIGHT = 20;
const BOTTOM_SLACK = 4;

export function LogPane({ projectId, script, scripts, onScriptChange, active, onActivate }: LogPaneProps) {
  const { lines, status, clear } = useLogStream(projectId, script);
  const [filters, setFilters] = useState<LogFilters>(NO_FILTERS);
  const [query, setQuery] = useState('');
  const [hitIndex, setHitIndex] = useState(0);
  const [follow, setFollow] = useState(true);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const exportLogs = useExportLogs(projectId);
  const openFileAt = useOpenFileAt(projectId);

  const visible = useMemo(() => visibleLines(lines, filters), [lines, filters]);
  const hits = useMemo(() => searchHits(visible, query), [visible, query]);
  const contexts = useMemo(() => contextsOf(lines), [lines]);
  const currentHit = hits.length > 0 ? hits[Math.min(hitIndex, hits.length - 1)] : undefined;

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
    getItemKey: (i) => visible[i]?.seq ?? i,
  });

  useEffect(() => {
    if (follow && visible.length > 0) virtualizer.scrollToIndex(visible.length - 1, { align: 'end' });
  }, [follow, visible.length, virtualizer]);

  useEffect(() => setHitIndex(0), [query]);

  const goToHit = (next: number) => {
    if (hits.length === 0) return;
    const i = (next + hits.length) % hits.length;
    setHitIndex(i);
    setFollow(false);
    const target = hits[i];
    if (target !== undefined) virtualizer.scrollToIndex(target, { align: 'center' });
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setFollow(el.scrollTop + el.clientHeight >= el.scrollHeight - BOTTOM_SLACK);
  };

  const onToggle = useCallback((seq: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });
  }, []);

  const onOpenLink = useCallback((link: LinkMatch) => openFileAt.mutate({ path: link.path, line: link.line }), [openFileAt]);

  const onExport = () => {
    if (script === null) return;
    if (!structuredFilterActive(filters)) {
      exportLogs.mutate({ script, seqs: 'all' });
      return;
    }
    if (visible.length > MAX_EXPORT_SEQS) {
      toast.error('Too many lines to export with a filter. Clear the filter to export everything.');
      return;
    }
    exportLogs.mutate({ script, seqs: visible.map((l) => l.seq) });
  };

  return (
    <section
      aria-label={script ? `${script} log` : 'Log pane'}
      onMouseDown={onActivate}
      onFocusCapture={onActivate}
      className={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card',
        active ? 'border-brand/60' : 'border-line',
      )}
    >
      <LogToolbar
        scripts={scripts}
        script={script}
        onScriptChange={onScriptChange}
        query={query}
        onQueryChange={setQuery}
        hitIndex={Math.min(hitIndex, Math.max(0, hits.length - 1))}
        hitCount={hits.length}
        onPrevHit={() => goToHit(hitIndex - 1)}
        onNextHit={() => goToHit(hitIndex + 1)}
        filters={filters}
        onFiltersChange={setFilters}
        contexts={contexts}
        follow={follow}
        onFollowChange={setFollow}
        onClear={() => void clear()}
        onExport={onExport}
      />
      {script === null ? (
        <p className="p-4 text-xs text-fg-muted">Pick a script to see its output.</p>
      ) : status === 'error' ? (
        <p className="p-4 text-xs text-err">Couldn't load the output of {script}.</p>
      ) : (
        <div
          ref={scrollRef}
          role="log"
          aria-live="off"
          aria-label={`${script} output`}
          tabIndex={0}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-auto bg-app font-mono text-[12px] leading-5"
        >
          {visible.length === 0 && status === 'ready' && (
            <p className="p-3 text-fg-faint">{lines.length === 0 ? 'No output yet.' : 'No lines match the filters.'}</p>
          )}
          <div className="relative w-max min-w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const line = visible[item.index];
              if (!line) return null;
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <LogRow
                    line={line}
                    query={query.trim()}
                    currentHit={currentHit === item.index}
                    expanded={expanded.has(line.seq)}
                    onToggle={onToggle}
                    onOpenLink={onOpenLink}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
