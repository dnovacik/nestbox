import { describe, expect, it } from 'vitest';
import { stripAnsi } from './ansi-strip';

describe('stripAnsi', () => {
  it('removes colours, cursor moves and OSC sequences', () => {
    expect(stripAnsi('\u001b[31mred\u001b[0m')).toBe('red');
    expect(stripAnsi('\u001b[2Kclear\u001b[1G')).toBe('clear');
    expect(stripAnsi('\u001b]8;;https://x.dev\u0007link\u001b]8;;\u0007')).toBe('link');
    expect(stripAnsi('\u001b]0;title\u001b\\after')).toBe('after');
  });

  it('leaves plain text alone', () => {
    expect(stripAnsi('plain [text] 100%')).toBe('plain [text] 100%');
  });
});
