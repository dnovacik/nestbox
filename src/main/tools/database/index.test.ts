import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetectedProject } from '@shared/detected';
import type { LogSnapshot } from '@shared/processes';
import { makeDetectedForTest } from '@shared/test-fixtures';
import type { DbStatus } from '@shared/tools/database/contract';
import { createMemoryLogger } from '../../logger';
import { fakePlatform, flushIo } from '../../processes/fake-child';
import { createEnvFileAccess } from '../env/env-files';
import { createSharedContext } from '../shared-context';
import type { AnyMainTool, ToolContext } from '../types';
import { createDatabaseTool } from './index';
import type { Reach } from './reach';

const URL = 'postgresql://alice:s3cr3t@localhost:5432/shop?schema=public';
const SCHEMA = 'datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}\n';

let root = '';
let tool: AnyMainTool | null = null;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nestbox-db-tool-'));
});
afterEach(async () => {
  await tool?.dispose?.();
  tool = null;
  await rm(root, { recursive: true, force: true });
});

async function files(entries: Record<string, string>) {
  for (const [rel, text] of Object.entries(entries)) {
    await mkdir(join(root, ...rel.split('/').slice(0, -1)), { recursive: true });
    await writeFile(join(root, ...rel.split('/')), text);
  }
}

function setup(project: Partial<DetectedProject> = { prismaSchema: 'prisma/schema.prisma', packageManager: 'pnpm' }, reach: Reach = { result: 'reachable', reason: null }) {
  const platform = { ...fakePlatform(), openTerminal: vi.fn(async () => undefined) };
  const logger = createMemoryLogger();
  const checkReachable = vi.fn(async () => reach);
  const firstFreePort = vi.fn(async () => 5556);
  tool = createDatabaseTool({ envFiles: createEnvFileAccess(), checkReachable, firstFreePort, logger });
  const emit = vi.fn();
  const ctx = {
    project: makeDetectedForTest({ path: root, envFiles: ['.env'], ...project }),
    shared: createSharedContext().forProject('p1'),
    emit,
    platform,
    settings: { get: () => ({}), update: (fn: (s: object) => object) => fn({}) },
  } as unknown as ToolContext;
  const call = <T,>(method: string, input: unknown = {}) => tool?.handlers[method]?.(ctx, input) as Promise<T>;
  /** The options of the nth spawnCommand call (fakePlatform's mock declares no parameters). */
  const spawned = (n = 0) =>
    (vi.mocked(platform.spawnCommand).mock.calls as unknown as [{ cwd: string; command: string; args: string[]; env: NodeJS.ProcessEnv; stdin?: string }][])[n]?.[0];
  return { call, ctx, emit, platform, logger, checkReachable, firstFreePort, spawned };
}

describe('database tool: status', () => {
  it('describes the URL from .env without credentials and checks it', async () => {
    await files({ 'prisma/schema.prisma': SCHEMA, '.env': `DATABASE_URL="${URL}"\n` });
    const { call, checkReachable } = setup();
    const status = await call<DbStatus>('status');
    expect(status).toEqual({
      prisma: { schema: 'prisma/schema.prisma' },
      variable: 'DATABASE_URL',
      url: { state: 'set', target: { provider: 'postgresql', host: 'localhost', port: 5432, database: 'shop', file: null, source: '.env' } },
      reach: { result: 'reachable', reason: null },
      running: { command: null, studio: null },
    });
    expect(JSON.stringify(status)).not.toMatch(/s3cr3t|alice/);
    expect(checkReachable).toHaveBeenCalledTimes(1);
  });

  it("uses the schema's variable name", async () => {
    await files({ 'prisma/schema.prisma': SCHEMA.replace('DATABASE_URL', 'APP_DB'), '.env': `APP_DB=${URL}\n` });
    expect(await setup().call<DbStatus>('status')).toMatchObject({ variable: 'APP_DB', url: { state: 'set' } });
  });

  it('reports a missing URL, and whether prisma.config.ts exists', async () => {
    await files({ 'prisma/schema.prisma': SCHEMA, '.env': 'PORT=1\n', 'prisma.config.ts': 'export default {}\n' });
    const { call, checkReachable } = setup();
    expect(await call<DbStatus>('status')).toMatchObject({ url: { state: 'missing', configTs: true }, reach: null });
    expect(checkReachable).not.toHaveBeenCalled();
  });

  it('reports a literal url in the schema without reading it', async () => {
    await files({ 'prisma/schema.prisma': 'datasource db {\n provider = "sqlite"\n url = "file:./dev.db"\n}' });
    expect(await setup().call<DbStatus>('status')).toMatchObject({ url: { state: 'literal' }, reach: null });
  });

  it('works without Prisma, from DATABASE_URL in .env', async () => {
    await files({ '.env': `DATABASE_URL=${URL}\n` });
    expect(await setup({ prismaSchema: null }).call<DbStatus>('status')).toMatchObject({ prisma: null, variable: 'DATABASE_URL', url: { state: 'set' } });
  });

  it('never logs the URL', async () => {
    await files({ 'prisma/schema.prisma': SCHEMA, '.env': `DATABASE_URL=${URL}\n` });
    const { call, logger } = setup();
    await call('status');
    expect(JSON.stringify(logger.entries)).not.toMatch(/s3cr3t|alice|localhost/);
  });
});

describe('database tool: commands', () => {
  beforeEach(async () => files({ 'prisma/schema.prisma': SCHEMA, '.env': `DATABASE_URL=${URL}\n` }));

  it('runs migrate status through the package manager with the schema, one at a time, into the log', async () => {
    const { call, platform, spawned } = setup();
    await call('run', { command: 'migrate-status' });
    expect(platform.spawnCommand).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: root, command: 'pnpm', args: ['exec', 'prisma', 'migrate', 'status', '--schema', 'prisma/schema.prisma'] }),
    );
    expect(spawned()).toMatchObject({ env: expect.objectContaining({ FORCE_COLOR: '1' }) });
    await expect(call('run', { command: 'generate' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await call<DbStatus>('status')).running.command).toBe('migrate-status');

    const child = platform.last();
    await flushIo();
    child.stdout.write('3 migrations found\n');
    child.exit(1);
    await flushIo();
    const logs = await call<LogSnapshot>('getLogs');
    expect(logs.lines.map((l) => l.text)).toEqual(['▸ prisma migrate status', '3 migrations found', '■ exited with code 1']);
    expect((await call<DbStatus>('status')).running.command).toBeNull();
  });

  it('stops a running command', async () => {
    const { call, platform } = setup();
    await call('run', { command: 'generate' });
    await flushIo();
    await call('stop', { what: 'command' });
    await flushIo();
    expect(platform.killTree).toHaveBeenCalledWith(platform.last().pid);
    expect((await call<LogSnapshot>('getLogs')).lines.at(-1)?.text).toBe('■ stopped');
  });

  it('opens migrate dev in a terminal', async () => {
    const { call, platform } = setup({ prismaSchema: 'prisma/schema.prisma', packageManager: 'npm' });
    await call('migrateDev');
    expect(platform.openTerminal).toHaveBeenCalledWith(root, 'npx --no-install prisma migrate dev --schema prisma/schema.prisma');
  });

  it('refuses Prisma commands without a schema', async () => {
    const { call } = setup({ prismaSchema: null });
    await expect(call('run', { command: 'generate' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(call('migrateDev')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('starts Studio on a free port, once, and stops it on dispose', async () => {
    const { call, platform, firstFreePort, spawned } = setup();
    expect(await call('startStudio')).toEqual({ port: 5556 });
    expect(firstFreePort).toHaveBeenCalledWith(5555, '127.0.0.1');
    expect(spawned()?.args).toEqual([
      'exec', 'prisma', 'studio', '--port', '5556', '--browser', 'none', '--schema', 'prisma/schema.prisma',
    ]);
    expect((await call<DbStatus>('status')).running.studio).toEqual({ port: 5556 });
    await expect(call('startStudio')).rejects.toMatchObject({ code: 'CONFLICT' });
    await flushIo();
    await tool?.dispose?.();
    expect(platform.killTree).toHaveBeenCalledWith(platform.last().pid);
  });

  it('reports a Studio that exits on its own', async () => {
    const { call, platform, emit } = setup();
    await call('startStudio');
    await flushIo();
    platform.last().exit(1);
    await flushIo();
    expect((await call<DbStatus>('status')).running.studio).toBeNull();
    expect((await call<LogSnapshot>('getLogs')).lines.at(-1)?.text).toBe('■ Studio stopped (code 1)');
    expect(emit).toHaveBeenCalledWith('changed', undefined);
  });
});

describe('database tool: test login', () => {
  beforeEach(async () => files({ 'prisma/schema.prisma': SCHEMA, '.env': `DATABASE_URL=${URL}\n` }));

  it('runs SELECT 1 through db execute and says it works', async () => {
    const { call, platform, spawned } = setup();
    const result = call<{ ok: boolean; message: string }>('testLogin');
    // It reads the schema and .env first.
    await vi.waitFor(() => expect(platform.spawnCommand).toHaveBeenCalled());
    await flushIo();
    const opts = spawned();
    expect(opts?.args).toEqual(['exec', 'prisma', 'db', 'execute', '--stdin', '--schema', 'prisma/schema.prisma']);
    expect(opts?.stdin).toBe('SELECT 1');
    platform.last().exit(0);
    expect(await result).toEqual({ ok: true, message: 'Login works' });
  });

  it("maps Prisma's error code to NestBox's own message, never Prisma's text", async () => {
    const { call, platform } = setup();
    const result = call<{ ok: boolean; message: string }>('testLogin');
    // It reads the schema and .env first.
    await vi.waitFor(() => expect(platform.spawnCommand).toHaveBeenCalled());
    await flushIo();
    platform.last().stderr.write('Error: P1000: Authentication failed for user `alice`\n');
    platform.last().exit(1);
    const out = await result;
    expect(out).toEqual({ ok: false, message: 'Wrong user or password' });
    const logs = await call<LogSnapshot>('getLogs');
    expect(JSON.stringify(logs)).not.toContain('alice');
  });

  it('is not offered for MongoDB', async () => {
    await files({ 'prisma/schema.prisma': SCHEMA.replace('postgresql', 'mongodb'), '.env': 'DATABASE_URL=mongodb://localhost/app\n' });
    await expect(setup().call('testLogin')).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
