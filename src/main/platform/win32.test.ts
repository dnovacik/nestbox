import { describe, expect, it, vi } from 'vitest';
import { NestboxError } from '@shared/errors';
import type { CommandRunner } from './adapter';
import { createWin32Adapter } from './win32';

interface Call {
  file: string;
  args: readonly string[];
  opts: { cwd?: string; verbatim?: boolean } | undefined;
}

function fakeRunner(failFiles: string[] = []): CommandRunner & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    launch: vi.fn(async (file: string, args: readonly string[], opts?: { cwd?: string; verbatim?: boolean }) => {
      calls.push({ file, args, opts });
      if (failFiles.includes(file)) {
        throw Object.assign(new Error(`spawn ${file} ENOENT`), { code: 'ENOENT' });
      }
    }),
  };
}

const PATHS = {
  spaces: 'C:\\Users\\me\\My Projects\\shop',
  amp: 'C:\\dev\\R&D\\app',
  caret: 'C:\\dev\\a^b',
  percent: 'C:\\dev\\100%\\app',
  semicolon: 'C:\\dev\\a;b',
  trailing: 'C:\\dev\\trailing slash\\',
};

describe('win32 openInEditor', () => {
  it('runs the editor through cmd.exe with escaped arguments', async () => {
    const runner = fakeRunner();
    const adapter = createWin32Adapter({ runner, getEditorCommand: () => 'code' });
    await adapter.openInEditor(PATHS.amp);
    expect(runner.calls[0]).toEqual({
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', '"code ^"C:\\dev\\R^&D\\app^""'],
      opts: { verbatim: true },
    });
  });

  it.each(Object.entries(PATHS))('escapes %s paths', async (_name, path) => {
    const runner = fakeRunner();
    const adapter = createWin32Adapter({ runner, getEditorCommand: () => 'code' });
    await adapter.openInEditor(path);
    const line = runner.calls[0]?.args[3] ?? '';
    expect(line.startsWith('"code ')).toBe(true);
    // the argument part: every metacharacter must be caret-escaped (no bare & ^ % ; space or quote)
    const argPart = line.slice('"code '.length, -1);
    expect(argPart.replace(/\^./g, '')).not.toMatch(/[&^%; "]/);
  });

  it('uses -g path:line when a line is given', async () => {
    const runner = fakeRunner();
    const adapter = createWin32Adapter({ runner, getEditorCommand: () => 'code' });
    await adapter.openInEditor('C:\\a\\b.ts', 12);
    expect(runner.calls[0]?.args[3]).toBe('"code ^"-g^" ^"C:\\a\\b.ts:12^""');
  });

  it('reports a NOT_FOUND error when the editor cannot start', async () => {
    const runner = fakeRunner(['cmd.exe']);
    const adapter = createWin32Adapter({ runner, getEditorCommand: () => 'code' });
    await expect(adapter.openInEditor('C:\\a')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects an unsafe path with VALIDATION and never calls the runner', async () => {
    const runner = fakeRunner();
    const adapter = createWin32Adapter({ runner, getEditorCommand: () => 'code' });
    await expect(adapter.openInEditor('C:\\a"b')).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(runner.launch).not.toHaveBeenCalled();
  });
});

describe('win32 openTerminal', () => {
  it.each(Object.entries(PATHS))('opens Windows Terminal with an escaped -d for %s paths', async (_n, path) => {
    const runner = fakeRunner();
    const adapter = createWin32Adapter({ runner, getEditorCommand: () => 'code' });
    await adapter.openTerminal(path);
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]).toEqual({
      file: 'wt.exe',
      args: ['-d', path.replace(/;/g, '\\;')],
      opts: undefined,
    });
  });

  it('runs a command in the new tab via cmd /k, escaping ;', async () => {
    const runner = fakeRunner();
    const adapter = createWin32Adapter({ runner, getEditorCommand: () => 'code' });
    await adapter.openTerminal('C:\\a', 'echo one; echo two');
    expect(runner.calls[0]?.args).toEqual(['-d', 'C:\\a', 'cmd.exe', '/k', 'echo one\\; echo two']);
  });

  it.each(Object.entries(PATHS))('falls back to cmd /K with the path as cwd for %s paths', async (_n, path) => {
    const runner = fakeRunner(['wt.exe']);
    const adapter = createWin32Adapter({ runner, getEditorCommand: () => 'code' });
    await adapter.openTerminal(path);
    expect(runner.calls[1]).toEqual({ file: 'cmd.exe', args: ['/d', '/k'], opts: { cwd: path } });
    // the path must never be spliced into the cmd command line
    expect(runner.calls[1]?.args.join(' ')).not.toContain(path);
  });

  it('does not fall back on errors other than ENOENT', async () => {
    const runner: CommandRunner = { launch: vi.fn().mockRejectedValue(new Error('EACCES')) };
    const adapter = createWin32Adapter({ runner, getEditorCommand: () => 'code' });
    await expect(adapter.openTerminal('C:\\a')).rejects.toBeInstanceOf(NestboxError);
    expect(runner.launch).toHaveBeenCalledTimes(1);
  });
});

describe('win32 other members', () => {
  const adapter = createWin32Adapter({ runner: fakeRunner(), getEditorCommand: () => 'code' });

  it('compares paths case-insensitively and ignores trailing separators', () => {
    expect(adapter.samePath('C:\\Dev\\Shop', 'c:\\dev\\shop\\')).toBe(true);
    expect(adapter.samePath('C:\\Dev\\Shop', 'C:\\Dev\\Shop2')).toBe(false);
  });

  it('uses a native title bar overlay', () => {
    expect(adapter.windowChrome({ color: 'a', symbolColor: 'b', height: 40 })).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: 'a', symbolColor: 'b', height: 40 },
    });
  });

  it('returns a copy of the inherited environment', async () => {
    const env = await adapter.resolveShellEnv();
    expect(env).toEqual(process.env);
    expect(env).not.toBe(process.env);
  });

  it('stubs M1/M2 members with NOT_IMPLEMENTED', async () => {
    await expect(adapter.listListeningPorts()).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
    await expect(adapter.killTree(1)).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
    expect(() => adapter.spawnScript({ cwd: 'C:\\', command: 'pnpm', args: [], env: {} })).toThrow(NestboxError);
  });
});
