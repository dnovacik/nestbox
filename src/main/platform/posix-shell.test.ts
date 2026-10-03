import { describe, expect, it, vi } from 'vitest';
import { createMemoryLogger } from '../logger';
import type { CommandRunner, ExecResult } from './adapter';
import { spawnRunner } from './command-runner';
import { createShellEnv, findOnPath, parseMarkedEnv } from './posix-shell';

const S = '__NB_S__';
const E = '__NB_E__';

describe('parseMarkedEnv', () => {
  it('reads NUL-separated pairs between the markers, ignoring banners', () => {
    const out = `Welcome to zsh!\n${S}PATH=/opt/homebrew/bin:/usr/bin\0EMPTY=\0EQ=a=b=c\0${E}bye\n`;
    expect(parseMarkedEnv(out, S, E)).toEqual({ PATH: '/opt/homebrew/bin:/usr/bin', EMPTY: '', EQ: 'a=b=c' });
  });

  it('keeps newlines inside values', () => {
    expect(parseMarkedEnv(`${S}MULTI=one\ntwo\0${E}`, S, E)).toEqual({ MULTI: 'one\ntwo' });
  });

  it('reads past $_, which holds the start marker', () => {
    expect(parseMarkedEnv(`${S}_=${S}\0PATH=/usr/bin\0${E}`, S, E)).toEqual({ _: S, PATH: '/usr/bin' });
  });

  it('is null without both markers', () => {
    expect(parseMarkedEnv(`${S}PATH=/usr/bin\0`, S, E)).toBeNull();
    expect(parseMarkedEnv('PATH=/usr/bin\0', S, E)).toBeNull();
  });
});

function fakeRunner(result: ExecResult | Error) {
  const exec = vi.fn(async (_file: string, args: readonly string[], _opts?: unknown): Promise<ExecResult> => {
    if (result instanceof Error) throw result;
    // Echo the markers the adapter chose, so the parser finds them.
    const [start = '', end = ''] = [...(args.at(-1) ?? '').matchAll(/printf '%s' (\S+)/g)].map((m) => m[1]?.replace(/;$/, ''));
    return { code: result.code, stdout: result.stdout.replace('<M>', start).replace('<M>', end) };
  });
  return { exec, runner: { launch: vi.fn(), spawn: vi.fn(), exec } as unknown as CommandRunner };
}

describe('createShellEnv', () => {
  it('runs the login shell once and caches the result', async () => {
    const { exec, runner } = fakeRunner({ code: 0, stdout: 'motd\n<M>PATH=/opt/homebrew/bin\0SECRET=s3cr3t\0<M>' });
    const logger = createMemoryLogger();
    const env = createShellEnv({ runner, shell: '/bin/zsh', fallback: { PATH: '/usr/bin' }, logger });
    const [a, b] = await Promise.all([env.get(), env.get()]);
    expect(a).toEqual({ PATH: '/opt/homebrew/bin', SECRET: 's3cr3t' });
    expect(b).toBe(a);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0]?.[0]).toBe('/bin/zsh');
    expect(exec.mock.calls[0]?.[1].slice(0, 1)).toEqual(['-ilc']);
    expect(JSON.stringify(logger.entries)).not.toContain('s3cr3t');
  });

  it('keeps a complete env even when the shell exit code is lost (a profile left a job holding stdout)', async () => {
    const { runner } = fakeRunner({ code: null, stdout: '<M>PATH=/opt/homebrew/bin\0<M>' });
    const logger = createMemoryLogger();
    const env = createShellEnv({ runner, shell: '/bin/zsh', fallback: { PATH: '/usr/bin' }, logger });
    expect(await env.get()).toEqual({ PATH: '/opt/homebrew/bin' });
    expect(logger.entries).toEqual([]);
  });

  it('stops reading at the end marker', async () => {
    const { exec, runner } = fakeRunner({ code: 0, stdout: '<M>A=1\0<M>' });
    await createShellEnv({ runner, shell: '/bin/zsh', fallback: {}, logger: createMemoryLogger() }).get();
    const opts = exec.mock.calls[0]?.[2] as { doneWhen?: (s: string) => boolean } | undefined;
    const script = exec.mock.calls[0]?.[1].at(-1) ?? '';
    const end = /printf '%s' (\S+)$/.exec(script)?.[1] ?? '';
    expect(opts?.doneWhen?.(`x${end}`)).toBe(true);
    expect(opts?.doneWhen?.('x')).toBe(false);
  });

  it('reads the shell again after 5 minutes', async () => {
    const { exec, runner } = fakeRunner({ code: 0, stdout: '<M>PATH=/usr/bin\0<M>' });
    let t = 0;
    const env = createShellEnv({ runner, shell: '/bin/zsh', fallback: {}, logger: createMemoryLogger(), now: () => t });
    await env.get();
    t = 299_000;
    await env.get();
    expect(exec).toHaveBeenCalledTimes(1);
    t = 300_000;
    await env.get();
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('falls back to the given env when the shell fails, and logs no values', async () => {
    const { runner } = fakeRunner({ code: 1, stdout: 'oops' });
    const logger = createMemoryLogger();
    const env = createShellEnv({ runner, shell: '/bin/zsh', fallback: { PATH: '/usr/bin', TOKEN: 'abc' }, logger });
    expect(await env.get()).toEqual({ PATH: '/usr/bin', TOKEN: 'abc' });
    expect(logger.entries.map((e) => e.message)).toEqual(['shell env unavailable']);
    expect(JSON.stringify(logger.entries)).not.toContain('abc');
  });

  it('falls back when the shell cannot start, and runs again after clear()', async () => {
    const { exec, runner } = fakeRunner(Object.assign(new Error('nope'), { code: 'ENOENT' }));
    const env = createShellEnv({ runner, shell: '/bin/nosh', fallback: { PATH: '/usr/bin' }, logger: createMemoryLogger() });
    expect(await env.get()).toEqual({ PATH: '/usr/bin' });
    env.clear();
    await env.get();
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it.skipIf(process.platform === 'win32')('reads a real shell environment', async () => {
    const logger = createMemoryLogger();
    const env = createShellEnv({ runner: spawnRunner, shell: '/bin/sh', fallback: {}, logger });
    const result = await env.get();
    expect(logger.entries).toEqual([]);
    expect(result['PATH']).toEqual(expect.stringContaining('/usr/bin'));
  });
});

describe('findOnPath', () => {
  const access = vi.fn(async (path: string) => ['/opt/homebrew/bin/pnpm', '/usr/local/bin/code'].includes(path));

  it('finds a command in the first PATH entry that has it', async () => {
    expect(await findOnPath('pnpm', '/usr/bin:/opt/homebrew/bin', access)).toBe('/opt/homebrew/bin/pnpm');
    expect(await findOnPath('code', '/usr/local/bin', access)).toBe('/usr/local/bin/code');
  });

  it('checks a path directly and refuses names with a slash in them relative to PATH', async () => {
    expect(await findOnPath('/usr/local/bin/code', '', access)).toBe('/usr/local/bin/code');
    expect(await findOnPath('bin/code', '/usr/local', access)).toBeNull();
  });

  it('is null when nothing matches', async () => {
    expect(await findOnPath('claude', '/usr/bin::/bin', access)).toBeNull();
  });

  it.skipIf(process.platform === 'win32')('skips a directory with the command name, and finds a real executable', async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = await mkdtemp(join(tmpdir(), 'nestbox-path-'));
    try {
      await mkdir(join(root, 'a', 'pnpm'), { recursive: true });
      await mkdir(join(root, 'b'));
      await writeFile(join(root, 'b', 'pnpm'), '#!/bin/sh\n', { mode: 0o755 });
      expect(await findOnPath('pnpm', `${join(root, 'a')}:${join(root, 'b')}`)).toBe(join(root, 'b', 'pnpm'));
      expect(await findOnPath('pnpm', join(root, 'a'))).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
