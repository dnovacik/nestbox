import { describe, expect, it } from 'vitest';
import { ansiProps, parseAnsi } from './ansi';

const ESC = '\u001b';

describe('parseAnsi', () => {
  it('splits text into styled segments', () => {
    const segs = parseAnsi(`${ESC}[31mred${ESC}[0m plain`);
    expect(segs.map((s) => s.text)).toEqual(['red', ' plain']);
    expect(segs[0]?.style.fg).toEqual({ kind: 'palette', index: 1 });
    expect(segs[1]?.style.fg).toBeNull();
  });

  it('handles bright and background colours', () => {
    const [seg] = parseAnsi(`${ESC}[92;44mx`);
    expect(seg?.style.fg).toEqual({ kind: 'palette', index: 10 });
    expect(seg?.style.bg).toEqual({ kind: 'palette', index: 4 });
    expect(parseAnsi(`${ESC}[103mx`)[0]?.style.bg).toEqual({ kind: 'palette', index: 11 });
  });

  it('handles 256-colour and truecolor', () => {
    expect(parseAnsi(`${ESC}[38;5;208mx`)[0]?.style.fg).toEqual({ kind: 'rgb', r: 255, g: 135, b: 0 });
    expect(parseAnsi(`${ESC}[38;5;3mx`)[0]?.style.fg).toEqual({ kind: 'palette', index: 3 });
    expect(parseAnsi(`${ESC}[38;5;240mx`)[0]?.style.fg).toEqual({ kind: 'rgb', r: 88, g: 88, b: 88 });
    expect(parseAnsi(`${ESC}[38;2;10;20;30mx`)[0]?.style.fg).toEqual({ kind: 'rgb', r: 10, g: 20, b: 30 });
    expect(parseAnsi(`${ESC}[48:2:10:20:30mx`)[0]?.style.bg).toEqual({ kind: 'rgb', r: 10, g: 20, b: 30 });
  });

  it('toggles attributes on and off', () => {
    const on = parseAnsi(`${ESC}[1;2;3;4;7mx`)[0]?.style;
    expect(on).toMatchObject({ bold: true, dim: true, italic: true, underline: true, inverse: true });
    const off = parseAnsi(`${ESC}[1;3;4;7m${ESC}[22;23;24;27mx`)[0]?.style;
    expect(off).toMatchObject({ bold: false, dim: false, italic: false, underline: false, inverse: false });
    expect(parseAnsi(`${ESC}[31m${ESC}[39mx`)[0]?.style.fg).toBeNull();
    expect(parseAnsi(`${ESC}[1m${ESC}[mx`)[0]?.style.bold).toBe(false);
  });

  it('drops cursor, erase and OSC sequences', () => {
    expect(parseAnsi(`${ESC}[2K${ESC}]0;title\u0007ok`).map((s) => s.text).join('')).toBe('ok');
  });

  it('survives malformed sequences', () => {
    expect(() => parseAnsi(`${ESC}[38;5mx${ESC}[38;2;1mx${ESC}[38;9mx`)).not.toThrow();
  });

  it('merges adjacent text with the same style', () => {
    expect(parseAnsi(`a${ESC}[2Kb`)).toHaveLength(1);
  });

  it('keeps the plain text equal to the stripped text', () => {
    const text = `${ESC}[1m${ESC}[32m✓${ESC}[39m src/a.ts:3 ${ESC}[2m(1 test)${ESC}[22m`;
    expect(parseAnsi(text).map((s) => s.text).join('')).toBe('✓ src/a.ts:3 (1 test)');
  });
});

describe('ansiProps', () => {
  const base = parseAnsi('x')[0]?.style;
  if (!base) throw new Error('no style');

  it('maps palette colours to token classes and rgb to inline styles', () => {
    expect(ansiProps({ ...base, fg: { kind: 'palette', index: 1 } }).className).toBe('ansi-fg-1');
    expect(ansiProps({ ...base, bg: { kind: 'palette', index: 12 } }).className).toBe('ansi-bg-12');
    expect(ansiProps({ ...base, fg: { kind: 'rgb', r: 10, g: 20, b: 30 } }).style).toEqual({ color: 'rgb(10 20 30)' });
  });

  it('maps attributes', () => {
    expect(ansiProps({ ...base, bold: true, dim: true, italic: true, underline: true }).className).toBe(
      'font-semibold opacity-60 italic underline',
    );
  });

  it('swaps colours for inverse', () => {
    expect(ansiProps({ ...base, inverse: true }).className).toBe('ansi-inverse');
    expect(ansiProps({ ...base, inverse: true, fg: { kind: 'palette', index: 2 } }).className).toBe('ansi-bg-2 ansi-fg-inverse');
  });

  it('gives a plain style no classes', () => {
    expect(ansiProps(base)).toEqual({ className: '' });
  });
});
