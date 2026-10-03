import { describe, expect, it } from 'vitest';
import { relativeTime } from './relative-time';

const NOW = 1_800_000_000_000;
const ago = (ms: number) => relativeTime(NOW - ms, NOW);
const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

describe('relativeTime', () => {
  it.each([
    [0, 'just now'],
    [44_000, 'just now'],
    [-5 * MIN, 'just now'],
    [MIN, '1 min ago'],
    [59 * MIN, '59 min ago'],
    [H, '1 h ago'],
    [23 * H, '23 h ago'],
    [D, '1 d ago'],
    [29 * D, '29 d ago'],
    [45 * D, '1 mo ago'],
    [400 * D, '1 y ago'],
  ])('%i ms ago is "%s"', (ms, text) => {
    expect(ago(ms)).toBe(text);
  });
});
