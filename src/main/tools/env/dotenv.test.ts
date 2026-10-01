import { describe, expect, it } from 'vitest';
import { addEntry, duplicateKeys, entries, formatValue, parseEnv, removeEntry, serializeEnv, setValue } from './dotenv';

const RICH = [
  '# Database',
  'DATABASE_URL=postgres://user:s3cr3t@localhost:5432/shop',
  '',
  'export NODE_ENV=development',
  '  INDENTED = spaced value   # trailing comment',
  "SINGLE='keep $HOME literal'",
  'DOUBLE="line1\\nline2"',
  'BACKTICK=`has "quotes" and \'apostrophes\'`',
  'HASH_IN_QUOTES="a#b"',
  'UNQUOTED_HASH=abc#def',
  'EMPTY=',
  'EMPTY_QUOTED=""',
  'MULTI="first',
  'second',
  'third"',
  'NOT AN ENTRY',
  'TEMPLATE=${OTHER}/path',
  'dotted.key-name=1',
  '',
].join('\n');

describe('parseEnv / serializeEnv', () => {
  it.each([
    ['rich LF file', RICH],
    ['CRLF file', RICH.replace(/\n/g, '\r\n')],
    ['no final newline', 'A=1\nB=2'],
    ['BOM', '\uFEFFA=1\n'],
    ['empty file', ''],
    ['only comments', '# a\n# b\n'],
    ['unterminated quote', 'A="never closed\nB=2\n'],
  ])('round-trips a %s byte for byte', (_name, text) => {
    expect(serializeEnv(parseEnv(text))).toBe(text);
  });

  it('reads values the way dotenv does', () => {
    const values = entries(parseEnv(RICH));
    expect(Object.fromEntries(values)).toEqual({
      DATABASE_URL: 'postgres://user:s3cr3t@localhost:5432/shop',
      NODE_ENV: 'development',
      INDENTED: 'spaced value',
      SINGLE: 'keep $HOME literal',
      DOUBLE: 'line1\nline2',
      BACKTICK: 'has "quotes" and \'apostrophes\'',
      HASH_IN_QUOTES: 'a#b',
      UNQUOTED_HASH: 'abc',
      EMPTY: '',
      EMPTY_QUOTED: '',
      MULTI: 'first\nsecond\nthird',
      TEMPLATE: '${OTHER}/path',
      'dotted.key-name': '1',
    });
  });

  it('stays fast on a large file full of unclosed quotes', () => {
    // One unclosed quote, then 20 000 plain lines (and quotes of the other kinds that must not count).
    const text =
      ["KEY='never closed", ...Array.from({ length: 20_000 }, (_, i) => `A_${i}="x" # say "${i}"`)].join('\n') + '\n';
    const started = performance.now();
    const doc = parseEnv(text);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(entries(doc).get('KEY')).toBe("'never closed");
    expect(entries(doc).get('A_19999')).toBe('x');
    expect(serializeEnv(doc)).toBe(text);
  });

  it('lets the last duplicate win and reports duplicates', () => {
    const doc = parseEnv('A=1\nB=2\nA=3\n');
    expect(entries(doc).get('A')).toBe('3');
    expect(duplicateKeys(doc)).toEqual(['A']);
  });

  it('keeps a BOM out of the first key', () => {
    expect([...entries(parseEnv('\uFEFFA=1\n')).keys()]).toEqual(['A']);
  });

  it('treats an unterminated quote as a value on its own line', () => {
    const doc = parseEnv('A="never closed\nB=2\n');
    expect(Object.fromEntries(entries(doc))).toEqual({ A: '"never closed', B: '2' });
  });
});

describe('setValue', () => {
  const lines = (text: string) => text.split('\n');

  it('changes only the edited line, keeping export, spacing, quotes and the comment', () => {
    const before = parseEnv(RICH);
    const after = serializeEnv(setValue(before, 'INDENTED', 'new'));
    const diff = lines(after).flatMap((l, i) => (l === lines(RICH)[i] ? [] : [[lines(RICH)[i], l]]));
    expect(diff).toEqual([['  INDENTED = spaced value   # trailing comment', '  INDENTED = new   # trailing comment']]);
    expect(serializeEnv(setValue(before, 'NODE_ENV', 'production'))).toContain('export NODE_ENV=production\n');
    expect(serializeEnv(setValue(before, 'SINGLE', 'x y'))).toContain("SINGLE='x y'\n");
  });

  it('quotes a value that needs it, and switches quotes when the old style cannot hold it', () => {
    const doc = parseEnv('A=1\nB="x"\n');
    expect(serializeEnv(setValue(doc, 'A', 'has space'))).toBe('A="has space"\nB="x"\n');
    expect(serializeEnv(setValue(doc, 'A', 'a#b'))).toBe('A="a#b"\nB="x"\n');
    expect(serializeEnv(setValue(doc, 'B', 'say "hi"'))).toBe('A=1\nB=\'say "hi"\'\n');
    expect(serializeEnv(setValue(doc, 'A', 'two\nlines'))).toBe('A="two\\nlines"\nB="x"\n');
  });

  it('replaces a multiline value completely', () => {
    const out = serializeEnv(setValue(parseEnv(RICH), 'MULTI', 'one'));
    expect(out).toContain('\nMULTI="one"\nNOT AN ENTRY\n');
    expect(out).not.toContain('second');
  });

  it('edits the last duplicate (the one dotenv uses)', () => {
    expect(serializeEnv(setValue(parseEnv('A=1\nA=2\n'), 'A', '9'))).toBe('A=1\nA=9\n');
  });

  it('keeps CRLF line endings', () => {
    expect(serializeEnv(setValue(parseEnv('A=1\r\nB=2\r\n'), 'A', '5'))).toBe('A=5\r\nB=2\r\n');
  });

  it('throws for an unknown key', () => {
    expect(() => setValue(parseEnv('A=1\n'), 'B', 'x')).toThrow(/not in this file/);
  });
});

describe('addEntry', () => {
  it('appends after the last entry, before trailing blank lines', () => {
    expect(serializeEnv(addEntry(parseEnv('# head\nA=1\n\n\n'), 'B', '2'))).toBe('# head\nA=1\nB=2\n\n\n');
  });

  it('adds a line ending to a last line without one', () => {
    expect(serializeEnv(addEntry(parseEnv('A=1'), 'B', '2'))).toBe('A=1\nB=2\n');
  });

  it('writes into an empty file, using the file line ending when it has one', () => {
    expect(serializeEnv(addEntry(parseEnv(''), 'A', 'x y'))).toBe('A="x y"\n');
    expect(serializeEnv(addEntry(parseEnv('# c\r\n'), 'A', '1'))).toBe('# c\r\nA=1\r\n');
  });

  it('refuses a key that already exists', () => {
    expect(() => addEntry(parseEnv('A=1\n'), 'A', '2')).toThrow(/already/);
  });
});

describe('removeEntry', () => {
  it('removes every occurrence, multiline values included, and nothing else', () => {
    expect(serializeEnv(removeEntry(parseEnv('A=1\nB="x\ny"\nC=3\nB=4\n'), 'B'))).toBe('A=1\nC=3\n');
  });
});

describe('formatValue', () => {
  it.each([
    ['plain', '', { raw: 'plain', quote: '' }],
    ['postgres://u:p@h:5432/db?ssl=true', '', { raw: 'postgres://u:p@h:5432/db?ssl=true', quote: '' }],
    ['${OTHER}/x', '', { raw: '${OTHER}/x', quote: '' }],
    ['', '', { raw: '', quote: '' }],
    ['', '"', { raw: '""', quote: '"' }],
    ['plain', "'", { raw: "'plain'", quote: "'" }],
    [' padded ', '', { raw: '" padded "', quote: '"' }],
    ['C:\\path\\new', '', { raw: "'C:\\path\\new'", quote: "'" }],
    ["it's", '', { raw: '"it\'s"', quote: '"' }],
  ] as const)('%j (preferred %j)', (value, preferred, expected) => {
    expect(formatValue(value, preferred)).toEqual(expected);
  });

  it('refuses a value no quote style can hold', () => {
    expect(() => formatValue('a\'b"c`d\\e', '')).toThrow(/cannot be written/);
  });
});
