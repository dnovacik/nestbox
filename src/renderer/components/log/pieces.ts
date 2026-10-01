import type { AnsiSegment, AnsiStyle } from './ansi';
import type { LinkMatch } from './links';

export interface Range {
  start: number;
  end: number;
}

export interface Piece {
  text: string;
  style: AnsiStyle;
  link: LinkMatch | null;
  /** Inside a search match. */
  match: boolean;
}

/** Case-insensitive, non-overlapping occurrences of `query` in `text`. */
export function findMatches(text: string, query: string): Range[] {
  const q = query.toLowerCase();
  if (!q) return [];
  const haystack = text.toLowerCase();
  const out: Range[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(q, from);
    if (at === -1) return out;
    out.push({ start: at, end: at + q.length });
    from = at + q.length;
  }
}

/**
 * Cuts styled segments at link and match boundaries. All ranges index the plain text, which is the
 * segments' text joined (parseAnsi guarantees it equals the ANSI-stripped line).
 */
export function decorate(segments: readonly AnsiSegment[], links: readonly LinkMatch[], matches: readonly Range[]): Piece[] {
  const cuts = new Set<number>();
  for (const r of [...links, ...matches]) {
    cuts.add(r.start);
    cuts.add(r.end);
  }
  const pieces: Piece[] = [];
  let offset = 0;
  for (const seg of segments) {
    const end = offset + seg.text.length;
    const points = [offset, ...[...cuts].filter((c) => c > offset && c < end).sort((a, b) => a - b), end];
    for (let i = 0; i < points.length - 1; i++) {
      const from = points[i] ?? 0;
      const to = points[i + 1] ?? 0;
      if (to <= from) continue;
      pieces.push({
        text: seg.text.slice(from - offset, to - offset),
        style: seg.style,
        link: links.find((l) => l.start <= from && to <= l.end) ?? null,
        match: matches.some((m) => m.start <= from && to <= m.end),
      });
    }
    offset = end;
  }
  return pieces;
}
