import { ArrowDownToLine, ChevronDown, ChevronUp, Download, Eraser, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { type LogFilters, structuredFilterActive } from './filters';
import { type Level, LEVELS } from './structured';

export const selectClass =
  'h-7 rounded-md border border-line bg-app px-2 text-xs text-fg focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none';

interface LogToolbarProps {
  scripts: string[];
  script: string | null;
  onScriptChange(script: string): void;
  query: string;
  onQueryChange(query: string): void;
  hitIndex: number;
  hitCount: number;
  onPrevHit(): void;
  onNextHit(): void;
  filters: LogFilters;
  onFiltersChange(filters: LogFilters): void;
  contexts: string[];
  follow: boolean;
  onFollowChange(follow: boolean): void;
  onClear(): void;
  onExport(): void;
}

export function LogToolbar(props: LogToolbarProps) {
  const { filters, onFiltersChange } = props;
  const toggleLevel = (level: Level) => {
    const levels = new Set(filters.levels);
    if (levels.has(level)) levels.delete(level);
    else levels.add(level);
    onFiltersChange({ ...filters, levels });
  };
  const disabled = props.script === null;

  return (
    <div className="flex flex-col gap-2 border-b border-line px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Script"
          className={cn(selectClass, 'font-mono')}
          value={props.script ?? ''}
          onChange={(e) => props.onScriptChange(e.target.value)}
        >
          {props.script === null && <option value="">Pick a script…</option>}
          {props.scripts.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <div className="relative min-w-40 flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-2 left-2 size-3.5 text-fg-muted" />
          <Input
            aria-label="Search output"
            placeholder="Search…"
            value={props.query}
            disabled={disabled}
            onChange={(e) => props.onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (e.shiftKey) props.onPrevHit();
              else props.onNextHit();
            }}
            className="h-7 bg-app pl-7 text-xs"
          />
        </div>
        {props.query.trim() !== '' && (
          <span className="font-mono text-[11px] text-fg-muted" aria-live="polite">
            {props.hitCount === 0 ? 'no matches' : `${props.hitIndex + 1} / ${props.hitCount}`}
          </span>
        )}
        <Button variant="ghost" size="icon" aria-label="Previous match" disabled={props.hitCount === 0} onClick={props.onPrevHit}>
          <ChevronUp />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Next match" disabled={props.hitCount === 0} onClick={props.onNextHit}>
          <ChevronDown />
        </Button>
        <Button
          variant={props.follow ? 'secondary' : 'ghost'}
          size="sm"
          aria-pressed={props.follow}
          disabled={disabled}
          onClick={() => props.onFollowChange(!props.follow)}
        >
          <ArrowDownToLine />
          Follow
        </Button>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={props.onClear}>
          <Eraser />
          Clear
        </Button>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={props.onExport}>
          <Download />
          Export
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div role="group" aria-label="Levels" className="flex gap-1">
          {LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={filters.levels.has(level)}
              onClick={() => toggleLevel(level)}
              className={cn(
                'rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase',
                filters.levels.has(level)
                  ? 'border-brand/40 bg-brand/15 text-brand'
                  : 'border-line text-fg-muted hover:text-fg',
              )}
            >
              {level}
            </button>
          ))}
        </div>
        <select
          aria-label="Context"
          className={selectClass}
          value={filters.context ?? ''}
          onChange={(e) => onFiltersChange({ ...filters, context: e.target.value === '' ? null : e.target.value })}
        >
          <option value="">All contexts</option>
          {props.contexts.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <Input
          aria-label="Request id"
          placeholder="Request id"
          value={filters.requestId}
          onChange={(e) => onFiltersChange({ ...filters, requestId: e.target.value })}
          className="h-7 w-36 bg-app text-xs"
        />
        {structuredFilterActive(filters) && (
          <span className="text-[11px] text-fg-faint">Showing matching entries and the lines under them</span>
        )}
      </div>
    </div>
  );
}
