import { ChevronDown, ChevronRight } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import type { LogLine } from '@shared/processes';
import { cn } from '@/lib/utils';
import { ansiProps, parseAnsi } from './ansi';
import { findLinks, type LinkMatch } from './links';
import { decorate, findMatches } from './pieces';
import { type Level, structuredOf } from './structured';

const LEVEL_CLASSES: Record<Level, string> = {
  fatal: 'border-err/30 bg-err/10 text-err',
  error: 'border-err/30 bg-err/10 text-err',
  warn: 'border-warn/30 bg-warn/10 text-warn',
  info: 'border-brand/30 bg-brand/10 text-brand',
  debug: 'border-line bg-surface text-fg-muted',
  trace: 'border-line bg-surface text-fg-muted',
};

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

export function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

interface LogRowProps {
  line: LogLine;
  query: string;
  currentHit: boolean;
  expanded: boolean;
  onToggle(seq: number): void;
  onOpenLink(link: LinkMatch): void;
}

/** Plain text with ANSI styles, links and search highlights; all positions index the ANSI-stripped text. */
function RichText({ text, query, onOpenLink }: { text: string; query: string; onOpenLink(link: LinkMatch): void }) {
  const segments = parseAnsi(text);
  const plain = segments.map((s) => s.text).join('');
  const pieces = decorate(segments, findLinks(plain), findMatches(plain, query));
  const out: ReactNode[] = [];
  pieces.forEach((piece, i) => {
    const props = ansiProps(piece.style);
    let node: ReactNode = (
      <span key={i} className={props.className || undefined} style={props.style}>
        {piece.text}
      </span>
    );
    if (piece.match) {
      node = (
        <mark key={i} className="rounded-sm bg-warn/30 text-fg">
          {node}
        </mark>
      );
    }
    const link = piece.link;
    if (link) {
      node = (
        <button
          key={i}
          type="button"
          className="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-brand"
          title={`Open ${link.path}:${link.line}`}
          onClick={() => onOpenLink(link)}
        >
          {node}
        </button>
      );
    }
    out.push(node);
  });
  return <>{out}</>;
}

export const LogRow = memo(function LogRow({ line, query, currentHit, expanded, onToggle, onOpenLink }: LogRowProps) {
  const structured = structuredOf(line);
  const time = <span className="shrink-0 text-fg-faint">{formatTime(structured?.time ?? line.ts)}</span>;
  const rowClass = cn(
    'flex gap-3 px-3 whitespace-pre',
    line.stream === 'stderr' && 'border-l-2 border-err/40',
    currentHit && 'bg-warn/10',
  );

  if (line.stream === 'system') {
    return (
      <div className={cn(rowClass, 'text-fg-faint italic')} data-stream="system">
        {time}
        <span>{line.text}</span>
      </div>
    );
  }

  if (!structured) {
    return (
      <div className={cn(rowClass, 'text-fg')} data-stream={line.stream}>
        {time}
        <span>
          <RichText text={line.text} query={query} onOpenLink={onOpenLink} />
        </span>
      </div>
    );
  }

  return (
    <div data-stream={line.stream} className={cn(currentHit && 'bg-warn/10')}>
      <div className={cn(rowClass, 'items-start text-fg')}>
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse entry' : 'Expand entry'}
          onClick={() => onToggle(line.seq)}
          className="mt-0.5 shrink-0 text-fg-faint hover:text-fg"
        >
          {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </button>
        {time}
        <span
          className={cn(
            'shrink-0 rounded border px-1 text-[10px] leading-4 font-semibold uppercase',
            LEVEL_CLASSES[structured.level],
          )}
        >
          {structured.level}
        </span>
        {structured.context && <span className="shrink-0 text-brand">[{structured.context}]</span>}
        <span className="min-w-0">
          <RichText text={structured.message} query={query} onOpenLink={onOpenLink} />
        </span>
        {structured.requestId && <span className="ml-auto shrink-0 pl-4 text-fg-faint">{structured.requestId}</span>}
      </div>
      {expanded && (
        <pre className="mx-3 mb-1 ml-10 rounded border border-line bg-surface/60 p-2 text-[11px] whitespace-pre text-fg-muted">
          {JSON.stringify(structured.raw, null, 2)}
        </pre>
      )}
    </div>
  );
});
