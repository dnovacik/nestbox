import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NestboxError } from '@shared/errors';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cmdInvocation, escapeCmdArg, escapeWtArg, quoteWindowsArg } from './win32-escape';

const TRICKY = [
  'C:\\Users\\me\\My Projects\\shop',
  'C:\\dev\\R&D\\app',
  'C:\\dev\\a^b\\app',
  'C:\\dev\\100%\\app',
  'C:\\dev\\%PATH%\\app',
  'C:\\dev\\a;b\\app',
  'C:\\dev\\trailing slash\\',
  'C:\\dev\\(x86) & [y]\\app',
  'C:\\dev\\wow!\\app',
];

describe('quoteWindowsArg', () => {
  it('always wraps in double quotes', () => {
    expect(quoteWindowsArg('C:\\a')).toBe('"C:\\a"');
    expect(quoteWindowsArg('')).toBe('""');
  });

  it('doubles trailing backslashes so the closing quote is not escaped', () => {
    expect(quoteWindowsArg('C:\\a b\\')).toBe('"C:\\a b\\\\"');
  });

  it('escapes embedded quotes and the backslashes before them', () => {
    expect(quoteWindowsArg('a"b')).toBe('"a\\"b"');
    expect(quoteWindowsArg('a\\"b')).toBe('"a\\\\\\"b"');
  });

  it('leaves backslashes that are not before a quote alone', () => {
    expect(quoteWindowsArg('C:\\x\\y')).toBe('"C:\\x\\y"');
  });
});

describe('escapeCmdArg', () => {
  it('caret-escapes quotes, spaces and cmd metacharacters', () => {
    expect(escapeCmdArg('C:\\R&D')).toBe('^"C:\\R^&D^"');
    expect(escapeCmdArg('a b')).toBe('^"a^ b^"');
    expect(escapeCmdArg('a^b')).toBe('^"a^^b^"');
    expect(escapeCmdArg('100%')).toBe('^"100^%^"');
    expect(escapeCmdArg('a;b')).toBe('^"a^;b^"');
  });
});

describe('cmdInvocation', () => {
  it('builds a cmd.exe /d /s /c line with an outer quote pair', () => {
    expect(cmdInvocation('code', ['C:\\R&D'])).toEqual({
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', '"code ^"C:\\R^&D^""'],
    });
  });
});

describe('cmdInvocation rejects unsafe characters', () => {
  const BAD = ['a"b', 'a\nb', 'a\rb', 'a\u0000b'];
  for (const bad of BAD) {
    const label = JSON.stringify(bad);
    it(`throws VALIDATION for ${label} in an argument`, () => {
      expect(() => cmdInvocation('code', [bad])).toThrow(NestboxError);
      expect(() => cmdInvocation('code', [bad])).toThrow(
        expect.objectContaining({ code: 'VALIDATION' }),
      );
    });
    it(`throws VALIDATION for ${label} in the command`, () => {
      expect(() => cmdInvocation(bad, ['x'])).toThrow(NestboxError);
      expect(() => cmdInvocation(bad, ['x'])).toThrow(
        expect.objectContaining({ code: 'VALIDATION' }),
      );
    });
  }
});

describe('escapeWtArg', () => {
  it('escapes ; so wt does not split sub-commands', () => {
    expect(escapeWtArg('C:\\dev\\a;b')).toBe('C:\\dev\\a\\;b');
    expect(escapeWtArg('C:\\plain')).toBe('C:\\plain');
  });
});

// Real round-trip through cmd.exe. Only meaningful on Windows.
describe.runIf(process.platform === 'win32')('cmd.exe round-trip', () => {
  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'nestbox-shim-'));
    writeFileSync(join(dir, 'echo.js'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
    // Same shape as VS Code's bin\code.cmd: forwards %* to node.
    writeFileSync(join(dir, 'echo-args.cmd'), '@node "%~dp0echo.js" %*\r\n');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function roundTrip(command: string, args: string[]): string[] {
    const inv = cmdInvocation(command, args);
    const r = spawnSync(inv.file, inv.args, { windowsVerbatimArguments: true, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout) as string[];
  }

  it('passes tricky paths unchanged to an .exe (node on PATH)', () => {
    for (const p of TRICKY) {
      expect(roundTrip('node', [join(dir, 'echo.js'), p])).toEqual([p]);
    }
  });

  it('passes tricky paths unchanged through a .cmd shim (like code.cmd)', () => {
    for (const p of TRICKY) {
      expect(roundTrip(join(dir, 'echo-args.cmd'), [p])).toEqual([p]);
    }
  });
});
