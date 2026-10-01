import { describe, expect, it, vi } from 'vitest';
import type { ExecResult } from '../../platform/adapter';
import { createClaudeCli } from './cli';

function fakePlatform(
  opts: {
    exists?: boolean | null;
    exec?: (command: string, args: readonly string[]) => Promise<ExecResult>;
  } = {},
) {
  return {
    commandExists: vi.fn(async () => (opts.exists === undefined ? true : opts.exists)),
    execCommand: vi.fn(
      async (command: string, args: readonly string[], _o: { cwd?: string; timeoutMs: number }) =>
        (await opts.exec?.(command, args)) ?? {
          code: 0,
          stdout: '2.1.0 (Claude Code)\r\nmore\r\n',
        },
    ),
  };
}

describe('claude cli status', () => {
  it('reports the version from the first line', async () => {
    const platform = fakePlatform();
    const cli = createClaudeCli({ platform, now: () => 0 });
    expect(await cli.status()).toEqual({ found: true, version: '2.1.0 (Claude Code)' });
    expect(platform.execCommand).toHaveBeenCalledWith(
      'claude',
      ['--version'],
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });

  it('says not found without running it', async () => {
    const platform = fakePlatform({ exists: false });
    const cli = createClaudeCli({ platform, now: () => 0 });
    expect(await cli.status()).toEqual({ found: false, version: null });
    expect(platform.execCommand).not.toHaveBeenCalled();
  });

  it('is unknown when the lookup is not possible', async () => {
    const cli = createClaudeCli({ platform: fakePlatform({ exists: null }), now: () => 0 });
    expect(await cli.status()).toEqual({ found: null, version: null });
  });

  it('keeps found when the version call fails', async () => {
    const cli = createClaudeCli({
      platform: fakePlatform({ exec: async () => Promise.reject(new Error('boom')) }),
      now: () => 0,
    });
    expect(await cli.status()).toEqual({ found: true, version: null });
  });

  it('caches the status for 60 s', async () => {
    let t = 0;
    const platform = fakePlatform();
    const cli = createClaudeCli({ platform, now: () => t });
    await cli.status();
    t = 59_000;
    await cli.status();
    expect(platform.commandExists).toHaveBeenCalledTimes(1);
    t = 61_000;
    await cli.status();
    expect(platform.commandExists).toHaveBeenCalledTimes(2);
  });

  it('shares one lookup between concurrent calls', async () => {
    const platform = fakePlatform();
    const cli = createClaudeCli({ platform, now: () => 0 });
    await Promise.all([cli.status(), cli.status()]);
    expect(platform.commandExists).toHaveBeenCalledTimes(1);
  });
});

describe('isIgnored', () => {
  const withCode = (code: number | null) =>
    createClaudeCli({
      platform: fakePlatform({ exec: async () => ({ code, stdout: '' }) }),
      now: () => 0,
    });

  it('maps git check-ignore exit codes', async () => {
    expect(await withCode(0).isIgnored('C:\\Dev\\Shop', 'CLAUDE.local.md')).toBe(true);
    expect(await withCode(1).isIgnored('C:\\Dev\\Shop', 'CLAUDE.local.md')).toBe(false);
    expect(await withCode(128).isIgnored('C:\\Dev\\Shop', 'CLAUDE.local.md')).toBeNull();
    expect(await withCode(null).isIgnored('C:\\Dev\\Shop', 'CLAUDE.local.md')).toBeNull();
  });

  it('runs git in the folder', async () => {
    const platform = fakePlatform({ exec: async () => ({ code: 0, stdout: '' }) });
    await createClaudeCli({ platform, now: () => 0 }).isIgnored('C:\\Dev\\Shop', 'CLAUDE.local.md');
    expect(platform.execCommand).toHaveBeenCalledWith(
      'git',
      ['check-ignore', '-q', 'CLAUDE.local.md'],
      expect.objectContaining({ cwd: 'C:\\Dev\\Shop' }),
    );
  });

  it('is unknown when git cannot run', async () => {
    const cli = createClaudeCli({
      platform: fakePlatform({ exec: async () => Promise.reject(new Error('ENOENT')) }),
      now: () => 0,
    });
    expect(await cli.isIgnored('C:\\Dev\\Shop', 'CLAUDE.local.md')).toBeNull();
  });
});
