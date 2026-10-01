export interface LinkMatch {
  start: number;
  end: number;
  path: string;
  line: number;
}

const EXT = 'ts|tsx|js|jsx|mjs|cjs|mts|cts|vue|svelte|astro|json|css|scss|less|html|md|mdx|prisma|graphql|ya?ml';
const REL = `(?:\\.{1,2}[\\\\/]|[\\\\/])?(?:[\\w@.-]+[\\\\/])*[\\w@.-]+\\.(?:${EXT})`;

/** Each pattern captures (path)(line). A match's whole text is the visible link. */
const PATTERNS: RegExp[] = [
  // file:///C:/dev/app/index.js:1:1
  /(file:\/\/\/[^\s'"()<>]+?):(\d+)(?::\d+)?(?!\d)/g,
  // Node stack frames in parentheses, where paths may contain spaces: (C:\a b\x.ts:12:5)
  /(?<=\()([A-Za-z]:[\\/][^()\r\n]+?):(\d+)(?::\d+)?(?=\))/g,
  // C:\dev\app\x.ts:12[:5]
  /(?<![\w/])([A-Za-z]:[\\/][^\s'"()<>|:]+):(\d+)(?::\d+)?(?!\d)/g,
  // tsc: src/app.ts(12,5)
  new RegExp(`(?<![\\w@./\\\\-])(${REL})\\((\\d+),\\d+\\)`, 'g'),
  // ./src/a.ts:12:5, src/a.ts:12, /src/App.tsx:3:1
  new RegExp(`(?<![\\w@.:/\\\\-])(${REL}):(\\d+)(?::\\d+)?(?!\\d)`, 'g'),
];

/** file:line references in a line of (ANSI-stripped) output, in order and without overlaps. */
export function findLinks(text: string): LinkMatch[] {
  const found: LinkMatch[] = [];
  for (const re of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const line = Number(m[2]);
      if (!m[1] || !Number.isInteger(line) || line < 1) continue;
      found.push({ start: m.index, end: m.index + m[0].length, path: m[1], line });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: LinkMatch[] = [];
  for (const link of found) {
    if (out.length === 0 || link.start >= (out.at(-1)?.end ?? 0)) out.push(link);
  }
  return out;
}
