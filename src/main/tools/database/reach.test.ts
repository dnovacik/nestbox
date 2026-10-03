import { createServer, type Server } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkReachable } from './reach';
import type { DbTarget } from './url';

const target = (patch: Partial<DbTarget>): DbTarget => ({ provider: 'postgresql', host: '127.0.0.1', port: 5432, database: 'shop', file: null, ...patch });

let server: Server | null = null;
let dir = '';
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = '';
});

function listen(): Promise<number> {
  return new Promise((resolve) => {
    server = createServer((socket) => socket.destroy());
    server.listen(0, '127.0.0.1', () => {
      const address = server?.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

describe('checkReachable', () => {
  it('says reachable when something accepts the connection', async () => {
    expect(await checkReachable(target({ port: await listen() }))).toEqual({ result: 'reachable', reason: null });
  });

  it('says refused for a closed port', async () => {
    const port = await listen();
    await new Promise<void>((r) => server?.close(() => r()));
    server = null;
    expect(await checkReachable(target({ port }))).toMatchObject({ result: 'refused' });
  });

  it('says dns for a host that does not resolve', async () => {
    expect(await checkReachable(target({ host: 'nestbox-test.invalid' }))).toMatchObject({ result: 'dns' });
  });

  it('times out on a connection that never completes', async () => {
    const never = () => {
      const fake = { destroy: () => undefined, once: () => fake, setTimeout: (_ms: number, cb: () => void) => void setTimeout(cb, 10) };
      return fake as never;
    };
    expect(await checkReachable(target({}), { connect: never, timeoutMs: 10 })).toMatchObject({ result: 'timeout' });
  });

  it('checks that a SQLite file exists', async () => {
    dir = await mkdtemp(join(tmpdir(), 'nestbox-reach-'));
    await writeFile(join(dir, 'dev.db'), '');
    const sqlite = { provider: 'sqlite', host: null, port: null, database: 'dev.db' };
    expect(await checkReachable(target({ ...sqlite, file: join(dir, 'dev.db') }))).toEqual({ result: 'reachable', reason: null });
    expect(await checkReachable(target({ ...sqlite, file: join(dir, 'gone.db') }))).toMatchObject({ result: 'missing-file' });
  });

  it.each<[Partial<DbTarget>, string]>([
    [{ provider: 'mongodb', port: null, host: 'cluster0.example.net' }, 'SRV'],
    [{ provider: 'accelerate', port: null, host: 'accelerate.prisma-data.net' }, 'Accelerate'],
    [{ provider: 'unknown', host: null, port: null }, 'recognised'],
  ])('does not check %o', async (patch, reason) => {
    const out = await checkReachable(target(patch));
    expect(out.result).toBe('not-checked');
    expect(out.reason).toContain(reason);
  });
});
