import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { type LogLine, MAX_EXPORT_SEQS } from '@shared/processes';
import { cn } from '@/lib/utils';
import { type LogFilters, NO_FILTERS, searchHits, structuredFilterActive, visibleLines } from './filters';
import type { LinkMatch } from './links';
import type { LogSource } from './log-source';
import { LogRow } from './LogRow';
import { LogToolbar } from './LogToolbar';
import { structuredOf } from './structured';
import { useLogStream } from './use-log-stream';

export interface LogViewProps {
  /** null: nothing picked yet (shows emptyHint). */
  source: LogSource | null;
  /** What the log is of, for labels ("dev" → "dev log", "dev output"). */
  name: string | null;
  emptyHint?: string;
  /** Before the search box, e.g. a script picker. */
  leading?: React.ReactNode;
  /** Shown above the lines, e.g. the EADDRINUSE banner. */
  renderBanner?: (lines: readonly LogLine[]) => React.ReactNode;
  /** Visible seqs (with a structured filter) or everything. Without it there is no Export. */
  onExport?: (seqs: number[] | 'all') => void;
  onOpenLink?: (link: LinkMatch) => void;
  /** Highlighted as the pane that the script list fills. */
  active?: boolean;
  onActivate?: () => void;
}

const ROW_HEIGHT = 20;
const BOTTOM_SLACK = 4;

/**
 * Contexts seen so far, updated from new lines only (the full buffer can hold a million lines and
 * changes every 50 ms). Contexts of cleared lines stay listed, which is harmless.
 */
function useContexts(lines: readonly LogLine[]): string[] {
  const seen = useRef({ set: new Set<string>(), upto: 0, list: [] as string[] });
  return useMemo(() => {
    const state = seen.current;
    let added = false;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line || line.seq <= state.upto) break;
      const context = structuredOf(line)?.context;
      if (context && !state.set.has(context)) {
        state.set.add(context);
        added = true;
      }
    }
    state.upto = Math.max(state.upto, lines.at(-1)?.seq ?? 0);
    if (added) state.list = [...state.set].sort();
    return state.list;
  }, [lines]);
}

/** A live, virtualised log with search, level/context/request filters, follow, clear and export. */
export function LogView({
  source,
  name,
  emptyHint = 'Nothing to show yet.',
  leading,
  renderBanner,
  onExport,
  onOpenLink,
  active = false,
  onActivate,
}: LogViewProps) {
  const { lines, status, clear } = useLogStream(source);
  const [filters, setFilters] = useState<LogFilters>(NO_FILTERS);
  const [query, setQuery] = useState('');
  const [hitIndex, setHitIndex] = useState(0);
  const [follow, setFollow] = useState(true);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => visibleLines(lines, filters), [lines, filters]);
  const hits = useMemo(() => searchHits(visible, query), [visible, query]);
  const contexts = useContexts(lines);
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

  const noLink = useCallback(() => {}, []);

  const exportVisible = () => {
    if (!onExport || source === null) return;
    if (!structuredFilterActive(filters)) {
      onExport('all');
      return;
    }
    if (visible.length > MAX_EXPORT_SEQS) {
      toast.error('Too many lines to export with a filter. Clear the filter to export everything.');
      return;
    }
    onExport(visible.map((l) => l.seq));
  };

  return (
    <section
      aria-label={name ? `${name} log` : 'Log pane'}
      onMouseDown={onActivate}
      onFocusCapture={onActivate}
      className={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card',
        active ? 'border-brand/60' : 'border-line',
      )}
    >
      <LogToolbar
        leading={leading}
        disabled={source === null}
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
        {...(onExport ? { onExport: exportVisible } : {})}
      />
      {source !== null && renderBanner?.(lines)}
      {source === null ? (
        <p className="p-4 text-xs text-fg-muted">{emptyHint}</p>
      ) : status === 'error' ? (
        <p className="p-4 text-xs text-err">Couldn't load the output of {name}. Retrying…</p>
      ) : (
        <div
          ref={scrollRef}
          role="log"
          aria-live="off"
          aria-label={`${name} output`}
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
                    onOpenLink={onOpenLink ?? noLink}
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
