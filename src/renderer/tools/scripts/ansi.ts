export type AnsiColor = { kind: 'palette'; index: number } | { kind: 'rgb'; r: number; g: number; b: number };

export interface AnsiStyle {
  fg: AnsiColor | null;
  bg: AnsiColor | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
}

export interface AnsiSegment {
  text: string;
  style: AnsiStyle;
}

export const PLAIN_STYLE: AnsiStyle = {
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
};

// SGR (group 1 holds the parameters), any other CSI, OSC, and two-byte escapes. Only SGR changes style.
// eslint-disable-next-line no-control-regex -- terminal escape sequences
const SEQUENCE = /\u001b\[([0-9;:]*)m|\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

/** Splits terminal output into styled segments. The segments' text joined equals stripAnsi(input). */
export function parseAnsi(input: string): AnsiSegment[] {
  const out: AnsiSegment[] = [];
  let style = PLAIN_STYLE;
  let last = 0;
  const push = (text: string): void => {
    if (!text) return;
    const prev = out.at(-1);
    if (prev && prev.style === style) prev.text += text;
    else out.push({ text, style });
  };
  for (const m of input.matchAll(SEQUENCE)) {
    push(input.slice(last, m.index));
    if (m[1] !== undefined) style = applySgr(style, m[1]);
    last = m.index + m[0].length;
  }
  push(input.slice(last));
  return out;
}

const palette = (index: number): AnsiColor => ({ kind: 'palette', index });
const cube = (v: number): number => (v === 0 ? 0 : 55 + v * 40);

function color256(n: number | undefined): AnsiColor | null {
  if (n === undefined || !Number.isInteger(n) || n < 0 || n > 255) return null;
  if (n < 16) return palette(n);
  if (n < 232) {
    const i = n - 16;
    return { kind: 'rgb', r: cube(Math.floor(i / 36)), g: cube(Math.floor(i / 6) % 6), b: cube(i % 6) };
  }
  const v = 8 + (n - 232) * 10;
  return { kind: 'rgb', r: v, g: v, b: v };
}

const byte = (v: number | undefined): v is number => v !== undefined && Number.isInteger(v) && v >= 0 && v <= 255;

function applySgr(current: AnsiStyle, params: string): AnsiStyle {
  const codes = params === '' ? [0] : params.split(/[;:]/).map((p) => (p === '' ? 0 : Number(p)));
  let s: AnsiStyle = { ...current };
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i] ?? 0;
    if (c === 0) s = { ...PLAIN_STYLE };
    else if (c === 1) s.bold = true;
    else if (c === 2) s.dim = true;
    else if (c === 3) s.italic = true;
    else if (c === 4) s.underline = true;
    else if (c === 7) s.inverse = true;
    else if (c === 22) {
      s.bold = false;
      s.dim = false;
    } else if (c === 23) s.italic = false;
    else if (c === 24) s.underline = false;
    else if (c === 27) s.inverse = false;
    else if (c >= 30 && c <= 37) s.fg = palette(c - 30);
    else if (c === 39) s.fg = null;
    else if (c >= 40 && c <= 47) s.bg = palette(c - 40);
    else if (c === 49) s.bg = null;
    else if (c >= 90 && c <= 97) s.fg = palette(c - 90 + 8);
    else if (c >= 100 && c <= 107) s.bg = palette(c - 100 + 8);
    else if (c === 38 || c === 48) {
      const mode = codes[i + 1];
      let color: AnsiColor | null = null;
      if (mode === 5) {
        color = color256(codes[i + 2]);
        i += 2;
      } else if (mode === 2) {
        const [r, g, b] = [codes[i + 2], codes[i + 3], codes[i + 4]];
        if (byte(r) && byte(g) && byte(b)) color = { kind: 'rgb', r, g, b };
        i += 4;
      } else {
        break;
      }
      if (c === 38) s.fg = color;
      else s.bg = color;
    }
  }
  return s;
}

const rgb = (c: { r: number; g: number; b: number }): string => `rgb(${c.r} ${c.g} ${c.b})`;

/** Classes for palette colours and attributes (tokens in globals.css); inline rgb() only for 256/truecolor. */
export function ansiProps(style: AnsiStyle): { className: string; style?: { color?: string; backgroundColor?: string } } {
  const classes: string[] = [];
  const inline: { color?: string; backgroundColor?: string } = {};
  const fg = style.inverse ? style.bg : style.fg;
  const bg = style.inverse ? style.fg : style.bg;
  if (fg?.kind === 'palette') classes.push(`ansi-fg-${fg.index}`);
  else if (fg?.kind === 'rgb') inline.color = rgb(fg);
  if (bg?.kind === 'palette') classes.push(`ansi-bg-${bg.index}`);
  else if (bg?.kind === 'rgb') inline.backgroundColor = rgb(bg);
  if (style.inverse) {
    if (!fg && !bg) classes.push('ansi-inverse');
    else if (!fg) classes.push('ansi-fg-inverse');
  }
  if (style.bold) classes.push('font-semibold');
  if (style.dim) classes.push('opacity-60');
  if (style.italic) classes.push('italic');
  if (style.underline) classes.push('underline');
  const result: { className: string; style?: { color?: string; backgroundColor?: string } } = { className: classes.join(' ') };
  if (inline.color || inline.backgroundColor) result.style = inline;
  return result;
}
