import { describe, expect, it } from 'vitest';
import { parseEtime, parsePsCommands, parsePsList } from './darwin-ps';

describe('parseEtime', () => {
  it.each([
    ['05', 5],
    ['01:05', 65],
    ['02:01:05', 2 * 3600 + 65],
    ['3-02:01:05', 3 * 86_400 + 2 * 3600 + 65],
    ['  00:00', 0],
  ])('%s → %i s', (text, seconds) => {
    expect(parseEtime(text)).toBe(seconds);
  });

  it.each(['', 'x', '1-2', '61:xx', '-01:00'])('rejects %j', (text) => {
    expect(parseEtime(text)).toBeNull();
  });
});

describe('parsePsList', () => {
  it('turns elapsed times into start times', () => {
    const now = 1_000_000_000_000;
    const out = '    1     0     1 3-02:01:05\n  412     1   412      10:00\n18244   412   412      00:03\n bad line\n';
    expect(parsePsList(out, now)).toEqual([
      { pid: 1, parentPid: 0, groupId: 1, startTime: now - (3 * 86_400 + 2 * 3600 + 65) * 1000 },
      { pid: 412, parentPid: 1, groupId: 412, startTime: now - 600_000 },
      { pid: 18244, parentPid: 412, groupId: 412, startTime: now - 3000 },
    ]);
  });
});

describe('parsePsList: brand-new processes', () => {
  it('treats an elapsed time older than the epoch as just started (ps wrapped a negative elapsed time)', () => {
    const now = 1_759_000_000_000;
    expect(parsePsList('  77     1    77 441077234-01:00:00\n', now)).toEqual([{ pid: 77, parentPid: 1, groupId: 77, startTime: now }]);
  });
});

describe('parsePsCommands', () => {
  it('maps PIDs to full command lines', () => {
    const out = '18244 node /Users/me/shop/node_modules/.bin/vite --port 5173\n  412 /opt/homebrew/opt/postgresql@17/bin/postgres -D x\n';
    expect(parsePsCommands(out)).toEqual(
      new Map([
        [18244, 'node /Users/me/shop/node_modules/.bin/vite --port 5173'],
        [412, '/opt/homebrew/opt/postgresql@17/bin/postgres -D x'],
      ]),
    );
  });

  it('skips lines without a command', () => {
    expect(parsePsCommands('  12   \n')).toEqual(new Map());
  });
});
