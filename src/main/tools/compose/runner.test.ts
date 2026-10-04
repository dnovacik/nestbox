import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogLine } from '@shared/processes';
import { createMemoryLogger } from '../../logger';
import { fakePlatform, flushIo } from '../../processes/fake-child';
import { collect, ComposePackage } from './runner';

type SpawnArgs = { cwd: string; command: string; args: string[] };

let pkg: ComposePackage | null = null;
afterEach(async () => {
  await pkg?.dispose();
  pkg = null;
  vi.useRealTimers();
});

function setup(opts: { actionTimeoutMs?: number } = {}) {
  const platform = fakePlatform();
  const logger = createMemoryLogger();
  const changed = vi.fn();
  const logs: Record<string, LogLine[]> = { actions: [], service: [] };
  pkg = new ComposePackage({
    platform,
    logger,
    cwd: '/work/shop',
    file: 'compose.yaml',
    projectId: 'p1',
    emit: { changed, logs: (source, lines) => logs[source]?.push(...lines) },
    ...opts,
  });
  const spawned = (n: number) =>
    (vi.mocked(platform.spawnCommand).mock.calls as unknown as [SpawnArgs][])[n]?.[0];
  const texts = (source: 'actions' | 'service') =>
    (pkg as ComposePackage).logs[source].snapshot().lines.map((l) => l.text);
  return { pkg, platform, logger, changed, spawned, texts };
}

const until = async (check: () => boolean) => {
  await vi.waitFor(() => expect(check()).toBe(true));
};

describe('collect', () => {
  it('runs docker compose with the file and returns stdout, stderr and the code', async () => {
    const platform = fakePlatform();
    const result = collect(platform, {
      cwd: '/work/shop',
      file: 'compose.yaml',
      args: ['config', '--services'],
      timeoutMs: 5_000,
      maxBytes: 1024,
    });
    await until(() => platform.children.length === 1);
    const child = platform.last();
    child.stdout.write('db\nweb\n');
    child.stderr.write('warning\n');
    child.exit(0);
    expect(await result).toEqual({ code: 0, stdout: 'db\nweb\n', stderr: 'warning\n' });
    const call = (vi.mocked(platform.spawnCommand).mock.calls as unknown as [SpawnArgs][])[0]?.[0];
    expect(call).toMatchObject({
      cwd: '/work/shop',
      command: 'docker',
      args: ['compose', '-f', 'compose.yaml', 'config', '--services'],
    });
  });

  it('gives null when docker cannot start', async () => {
    const platform = fakePlatform();
    platform.failNextSpawn();
    expect(
      (
        await collect(platform, {
          cwd: '/x',
          file: 'compose.yaml',
          args: ['ps'],
          timeoutMs: 5_000,
          maxBytes: 1024,
        })
      ).code,
    ).toBeNull();
  });
});

describe('ComposePackage actions', () => {
  it('runs up -d for the stack and stop for one service, with output in the Actions log', async () => {
    const { pkg, platform, spawned, texts, changed, logger } = setup();
    const up = pkg.runAction('up', []);
    await until(() => platform.children.length === 1);
    expect(spawned(0)?.args).toEqual(['compose', '-f', 'compose.yaml', 'up', '-d']);
    expect(pkg.action).toEqual({ name: 'up', service: null });
    platform.last().stderr.write(' Container shop-db-1  Started\n');
    platform.last().exit(0);
    expect(await up).toEqual({ ok: true, code: 0 });
    expect(texts('actions')).toEqual([
      '▸ docker compose up -d',
      ' Container shop-db-1  Started',
      '■ done',
    ]);
    expect(pkg.action).toBeNull();
    expect(changed).toHaveBeenCalledTimes(2);

    const stop = pkg.runAction('stop', ['web']);
    await until(() => platform.children.length === 2);
    expect(spawned(1)?.args).toEqual(['compose', '-f', 'compose.yaml', 'stop', 'web']);
    platform.last().exit(1);
    expect(await stop).toEqual({ ok: false, code: 1 });
    expect(texts('actions').at(-1)).toBe('■ exited with code 1');
    expect(JSON.stringify(logger.entries)).not.toMatch(/Container|shop-db/);
  });

  it('passes several services, and --wait for up when asked', async () => {
    const { pkg, platform, spawned } = setup();
    const up = pkg.runAction('up', ['db', 'redis'], { wait: true });
    await until(() => platform.children.length === 1);
    expect(spawned(0)?.args).toEqual([
      'compose',
      '-f',
      'compose.yaml',
      'up',
      '-d',
      '--wait',
      '--wait-timeout',
      '120',
      'db',
      'redis',
    ]);
    expect(pkg.action).toEqual({ name: 'up', service: null });
    platform.last().exit(0);
    await up;
    const stop = pkg.runAction('stop', ['db', 'redis']);
    await until(() => platform.children.length === 2);
    expect(spawned(1)?.args).toEqual(['compose', '-f', 'compose.yaml', 'stop', 'db', 'redis']);
    platform.last().exit(0);
    await stop;
  });

  it('refuses a second action while one runs', async () => {
    const { pkg, platform } = setup();
    const first = pkg.runAction('up', []);
    await expect(pkg.runAction('down', [])).rejects.toMatchObject({ code: 'CONFLICT' });
    await until(() => platform.children.length === 1);
    platform.last().exit(0);
    await first;
  });

  it('kills an action that runs past the timeout', async () => {
    const { pkg, platform, texts } = setup({ actionTimeoutMs: 50 });
    const result = await pkg.runAction('up', []);
    expect(platform.killTree).toHaveBeenCalled();
    expect(result).toEqual({ ok: false, code: null });
    expect(texts('actions').at(-1)).toBe('■ timed out');
  });
});

describe('ComposePackage logs', () => {
  it('follows one service at a time, clearing the buffer on a switch', async () => {
    const { pkg, platform, spawned, texts } = setup();
    await pkg.follow('db');
    expect(spawned(0)?.args).toEqual([
      'compose',
      '-f',
      'compose.yaml',
      'logs',
      '-f',
      '--no-color',
      '--no-log-prefix',
      '--tail',
      '500',
      'db',
    ]);
    platform.last().stdout.write('ready to accept connections\n');
    await flushIo();
    expect(texts('service')).toEqual(['ready to accept connections']);
    const dbChild = platform.last();

    await pkg.follow('web');
    expect(
      dbChild.pid !== undefined &&
        vi.mocked(platform.killTree).mock.calls.some(([pid]) => pid === dbChild.pid),
    ).toBe(true);
    expect(pkg.following).toBe('web');
    await flushIo();
    expect(texts('service')).toEqual([]);
  });

  it('says when the stream ends by itself, and not after unfollow', async () => {
    const { pkg, platform, texts } = setup();
    await pkg.follow('db');
    platform.last().exit(0);
    await until(() => pkg.following === null);
    expect(texts('service')).toEqual(['■ log stream ended']);

    await pkg.follow('db');
    await pkg.unfollow();
    await flushIo();
    expect(pkg.following).toBeNull();
    expect(texts('service')).toEqual([]);
  });

  it('keeps only the last of two quick follows', async () => {
    const { pkg, platform } = setup();
    await Promise.all([pkg.follow('db'), pkg.follow('web')]);
    expect(pkg.following).toBe('web');
    expect(platform.children).toHaveLength(2);
    expect(vi.mocked(platform.killTree)).toHaveBeenCalledTimes(1);
  });

  it('dispose kills the action and the follower', async () => {
    const { pkg, platform } = setup();
    await pkg.follow('db');
    void pkg.runAction('up', []);
    await until(() => platform.children.length === 2);
    await pkg.dispose();
    expect(platform.killTree).toHaveBeenCalledTimes(2);
  });
});
