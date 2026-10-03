// Finds a tagged comment (TODO, FIXME, …) on one line. A tag counts only right after a comment marker, so
// identifiers (todoList), plurals (TODOS) and words in strings or URLs don't match.

export interface LineMatch {
  /** The tag as configured (upper case). */
  tag: string;
  text: string;
  /** The name in TODO(name). */
  owner: string | null;
}

export const MAX_TEXT = 300;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cache = new Map<string, RegExp>();

/**
 * A comment marker at the start of the line or after whitespace (`//`, `#`, `/*`, `{/*`, `<!--`, `--`, `;`),
 * or a JSDoc ` * ` at the start of a line; then the tag as a whole word, an optional (owner), and `:`,
 * whitespace or the end of the line.
 */
function patternFor(tags: readonly string[]): RegExp {
  const key = tags.join('\0');
  let re = cache.get(key);
  if (!re) {
    const alternatives = tags.map(escape).join('|');
    re = new RegExp(
      `(?:^\\s*\\*+|(?:^|\\s)(?:\\/\\/+|#+|\\{\\/\\*+|\\/\\*+|<!--|--|;+))\\s*(${alternatives})(?:\\(([^)]*)\\))?(?=[:\\s]|$)(.*)$`,
      'i',
    );
    cache.set(key, re);
  }
  return re;
}

export function matchLine(line: string, tags: readonly string[]): LineMatch | null {
  if (tags.length === 0) return null;
  const m = patternFor(tags).exec(line);
  if (!m) return null;
  const tag = tags.find((t) => t.toLowerCase() === (m[1] ?? '').toLowerCase()) ?? (m[1] ?? '').toUpperCase();
  const text = (m[3] ?? '')
    .replace(/^\s*:?\s*/, '')
    .replace(/\s*(\*+\/\s*\}?|-->)\s*$/, '')
    .trim()
    .slice(0, MAX_TEXT);
  const owner = m[2]?.trim() || null;
  return { tag, text, owner };
}
