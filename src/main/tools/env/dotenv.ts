// A .env reader and writer that keeps files as they are: untouched lines stay byte-identical, so
// comments, blank lines, key order, `export` prefixes, spacing and quote styles survive an edit.
// Values follow dotenv: unquoted values stop at `#` and are trimmed; double quotes expand \n and \r;
// single quotes and backticks are literal; any quote may span lines. `${VAR}` is kept verbatim.
import { NestboxError } from '@shared/errors';

export type Quote = '' | "'" | '"' | '`';

interface Plain {
  kind: 'blank' | 'comment' | 'other';
  /** The line(s) exactly as in the file, line ending included. */
  raw: string;
}

export interface Entry {
  kind: 'entry';
  raw: string;
  key: string;
  value: string;
  quote: Quote;
  exported: boolean;
  /** Everything up to the value: indentation, `export `, key, spaces and `=`, spaces after it. */
  prefix: string;
  /** Spaces and an inline comment after the value. */
  suffix: string;
  /** The line ending after the entry ('' on a last line without one). */
  eol: string;
}

export type EnvLine = Plain | Entry;

export interface EnvDocument {
  bom: boolean;
  lines: EnvLine[];
  /** Line ending for new lines: the file's first one, '\n' when it has none. */
  eol: '\n' | '\r\n';
}

const ENTRY = /^(\s*)(export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)(\s*=\s*)(.*)$/;

interface Physical {
  text: string;
  eol: string;
}

function physicalLines(text: string): Physical[] {
  const out: Physical[] = [];
  let start = 0;
  while (start < text.length) {
    const lf = text.indexOf('\n', start);
    if (lf === -1) {
      out.push({ text: text.slice(start), eol: '' });
      break;
    }
    const crlf = lf > start && text[lf - 1] === '\r';
    out.push({ text: text.slice(start, crlf ? lf - 1 : lf), eol: crlf ? '\r\n' : '\n' });
    start = lf + 1;
  }
  return out;
}

/** Index of the closing quote in s at or after from (a double quote may be escaped with a backslash). */
function closingQuote(s: string, quote: Quote, from: number): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] === '\\' && quote === '"') {
      i++;
      continue;
    }
    if (s[i] === quote) return i;
  }
  return -1;
}

function unquoted(rest: string): { valueRaw: string; suffix: string; value: string } {
  const hash = rest.indexOf('#');
  const body = hash === -1 ? rest : rest.slice(0, hash);
  const value = body.trimEnd();
  return { valueRaw: value, suffix: rest.slice(value.length), value: value.trim() };
}

/** Parses the entry that starts at physical line i; returns it and how many physical lines it used. */
function parseEntry(lines: Physical[], i: number, match: RegExpExecArray): { entry: Entry; used: number } {
  const [, indent = '', exportWord = '', key = '', equals = '', rest = ''] = match;
  const prefix = `${indent}${exportWord}${key}${equals}`;
  const base = { kind: 'entry' as const, key, exported: exportWord !== '', prefix };
  const first = lines[i] as Physical;
  const open = rest[0];
  if (open === '"' || open === "'" || open === '`') {
    const quote = open as Quote;
    // Same line first, then the following lines (a multiline value).
    let body = rest;
    let used = 1;
    let close = closingQuote(body, quote, 1);
    while (close === -1 && i + used < lines.length) {
      const next = lines[i + used] as Physical;
      body += (lines[i + used - 1] as Physical).eol + next.text;
      used++;
      close = closingQuote(body, quote, 1);
    }
    if (close !== -1) {
      const inner = body.slice(1, close).replace(/\r\n/g, '\n');
      const value = quote === '"' ? inner.replace(/\\n/g, '\n').replace(/\\r/g, '\r') : inner;
      const last = lines[i + used - 1] as Physical;
      const suffix = body.slice(close + 1);
      return {
        entry: { ...base, raw: `${prefix}${body}${last.eol}`, value, quote, suffix, eol: last.eol },
        used,
      };
    }
  }
  const { valueRaw, suffix, value } = unquoted(rest);
  return {
    entry: { ...base, raw: `${prefix}${valueRaw}${suffix}${first.eol}`, value, quote: '', suffix, eol: first.eol },
    used: 1,
  };
}

export function parseEnv(text: string): EnvDocument {
  const bom = text.startsWith('﻿');
  const lines = physicalLines(bom ? text.slice(1) : text);
  const doc: EnvDocument = { bom, lines: [], eol: lines.find((l) => l.eol !== '')?.eol === '\r\n' ? '\r\n' : '\n' };
  for (let i = 0; i < lines.length; ) {
    const line = lines[i] as Physical;
    const match = ENTRY.exec(line.text);
    if (match) {
      const { entry, used } = parseEntry(lines, i, match);
      doc.lines.push(entry);
      i += used;
      continue;
    }
    const trimmed = line.text.trim();
    doc.lines.push({ kind: trimmed === '' ? 'blank' : trimmed.startsWith('#') ? 'comment' : 'other', raw: line.text + line.eol });
    i++;
  }
  return doc;
}

export function serializeEnv(doc: EnvDocument): string {
  return (doc.bom ? '﻿' : '') + doc.lines.map((l) => l.raw).join('');
}

const isEntry = (line: EnvLine): line is Entry => line.kind === 'entry';

/** Key → value; the last occurrence of a key wins, as in dotenv. */
export function entries(doc: EnvDocument): Map<string, string> {
  return new Map(doc.lines.filter(isEntry).map((e) => [e.key, e.value]));
}

export function duplicateKeys(doc: EnvDocument): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const e of doc.lines.filter(isEntry)) {
    if (seen.has(e.key) && !dupes.includes(e.key)) dupes.push(e.key);
    seen.add(e.key);
  }
  return dupes;
}

const SAFE_UNQUOTED = /^[^\s#'"`\\]*$/;

function fits(value: string, quote: Quote): boolean {
  switch (quote) {
    case '':
      return SAFE_UNQUOTED.test(value);
    case '"':
      // Newlines are written as \n; a literal backslash or quote would not read back the same.
      return !value.includes('"') && !value.includes('\\');
    case "'":
    case '`':
      return !value.includes(quote) && !/[\r\n]/.test(value);
  }
}

/** How a value is written: in the preferred quote style when it can hold the value, else the first that can. */
export function formatValue(value: string, preferred: Quote): { raw: string; quote: Quote } {
  const order: Quote[] = [preferred, ...(['', '"', "'", '`'] as const).filter((q) => q !== preferred)];
  const quote = order.find((q) => fits(value, q));
  if (quote === undefined) throw new NestboxError('VALIDATION', 'This value cannot be written to a .env file');
  const body = quote === '"' ? value.replace(/\n/g, '\\n').replace(/\r/g, '\\r') : value;
  return { raw: `${quote}${body}${quote}`, quote };
}

function rebuild(entry: Entry, value: string): Entry {
  const { raw, quote } = formatValue(value, entry.quote);
  return { ...entry, value, quote, raw: `${entry.prefix}${raw}${entry.suffix}${entry.eol}` };
}

/** Sets the value of the last occurrence of key (the one dotenv reads). */
export function setValue(doc: EnvDocument, key: string, value: string): EnvDocument {
  let index = -1;
  doc.lines.forEach((line, i) => {
    if (isEntry(line) && line.key === key) index = i;
  });
  const target = doc.lines[index];
  if (!target || !isEntry(target)) throw new NestboxError('NOT_FOUND', 'That key is not in this file');
  const lines = [...doc.lines];
  lines[index] = rebuild(target, value);
  return { ...doc, lines };
}

/** Appends key=value after the last non-blank line. */
export function addEntry(doc: EnvDocument, key: string, value: string): EnvDocument {
  if (doc.lines.some((l) => isEntry(l) && l.key === key)) {
    throw new NestboxError('CONFLICT', 'That key is already in this file');
  }
  const lines = [...doc.lines];
  let at = lines.length;
  while (at > 0 && lines[at - 1]?.kind === 'blank') at--;
  const before = lines[at - 1];
  if (before && !/\n$/.test(before.raw)) {
    lines[at - 1] = isEntry(before) ? { ...before, raw: before.raw + doc.eol, eol: doc.eol } : { ...before, raw: before.raw + doc.eol };
  }
  const { raw, quote } = formatValue(value, '');
  const entry: Entry = { kind: 'entry', key, value, quote, exported: false, prefix: `${key}=`, suffix: '', eol: doc.eol, raw: `${key}=${raw}${doc.eol}` };
  lines.splice(at, 0, entry);
  return { ...doc, lines };
}

/** Removes every occurrence of key. */
export function removeEntry(doc: EnvDocument, key: string): EnvDocument {
  return { ...doc, lines: doc.lines.filter((l) => !(isEntry(l) && l.key === key)) };
}
