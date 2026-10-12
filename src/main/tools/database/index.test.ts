import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetectedProject } from '@shared/detected';
import type { LogSnapshot } from '@shared/processes';
import { makeDetectedForTest } from '@shared/test-fixtures';
import { databaseDefinition, type DbStatus } from '@shared/tools/database/contract';
import { createMemoryLogger } from '../../logger';
import { fakePlatform, flushIo } from '../../processes/fake-child';
import { createConfigFileAccess, createEnvFileAccess } from '../env/env-files';
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
  const platform = { ...fakePlatform(), openTerminal: vi.fn(async () => undefined), commandExists: vi.fn(async () => false) };
  const logger = createMemoryLogger();
  const checkReachable = vi.fn(async () => reach);
  const firstFreePort = vi.fn(async () => 5556);
  const dotnetRunEnv = vi.fn(async () => ({ pathPrepend: join(root, 'sdk') }));
  tool = createDatabaseTool({
    envFiles: createEnvFileAccess(),
    configFiles: createConfigFileAccess(),
    checkReachable,
    firstFreePort,
    logger,
    home: join(root, 'home'),
    dotnetRunEnv,
  });
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
      dotnet: null,
      ef: null,
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

const PRISMA_INSTALLED = { 'node_modules/prisma/package.json': '{"name":"prisma"}' };

describe('database tool: commands', () => {
  beforeEach(async () => files({ 'prisma/schema.prisma': SCHEMA, '.env': `DATABASE_URL=${URL}\n`, ...PRISMA_INSTALLED }));

  it('says Prisma is not installed instead of running it', async () => {
    await rm(join(root, 'node_modules'), { recursive: true });
    const { call, platform } = setup();
    await expect(call('run', { command: 'generate' })).rejects.toMatchObject({ code: 'NOT_FOUND', message: "Prisma isn't installed in this package" });
    await expect(call('startStudio')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(call('migrateDev')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(platform.spawnCommand).not.toHaveBeenCalled();
  });

  it('finds Prisma installed in a parent folder (a workspace root)', async () => {
    await rm(join(root, 'node_modules'), { recursive: true });
    await files({ 'packages/api/prisma/schema.prisma': SCHEMA, ...PRISMA_INSTALLED });
    const { call, platform } = setup({ prismaSchema: 'prisma/schema.prisma', packageManager: 'pnpm', path: join(root, 'packages', 'api') });
    await call('run', { command: 'generate' });
    expect(platform.spawnCommand).toHaveBeenCalled();
  });

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
  beforeEach(async () => files({ 'prisma/schema.prisma': SCHEMA, '.env': `DATABASE_URL=${URL}\n`, ...PRISMA_INSTALLED }));

  it('says Prisma is not installed', async () => {
    await rm(join(root, 'node_modules'), { recursive: true });
    const { call, platform } = setup();
    expect(await call('testLogin')).toEqual({ ok: false, message: "Prisma isn't installed in this package" });
    expect(platform.spawnCommand).not.toHaveBeenCalled();
  });

  it('gives the exit code when Prisma fails without an error code', async () => {
    const { call, platform } = setup();
    const result = call<{ ok: boolean; message: string }>('testLogin');
    await vi.waitFor(() => expect(platform.spawnCommand).toHaveBeenCalled());
    await flushIo();
    platform.last().exit(2);
    expect(await result).toEqual({ ok: false, message: 'Failed (exit code 2)' });
  });

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

describe('database tool: .NET connection strings', () => {
  const dotnet = (over: Record<string, unknown> = {}): Partial<DetectedProject> => ({
    prismaSchema: null,
    packageJson: null,
    packageManager: null,
    envFiles: [],
    ecosystems: [
      {
        id: 'dotnet',
        info: {
          solution: null,
          project: 'Shop.Api.csproj',
          targetFrameworks: ['net10.0'],
          isWeb: true,
          isTest: false,
          dbProviders: ['postgresql'],
          sdk: null,
          launchProfiles: [
            { name: 'http', ports: [5283], environment: 'Development' },
            { name: 'prod', ports: [], environment: 'Production' },
          ],
          ...over,
        },
      },
    ],
  });

  beforeEach(async () =>
    files({
      'appsettings.json': `{
  // base
  "ConnectionStrings": { "Shop": "Host=prod.db;Port=5432;Database=shop;Username=alice;Password=s3cr3t", "Cache": "Server=.\\\\SQLEXPRESS" }
}`,
      'appsettings.Development.json': '{ "ConnectionStrings": { "Shop": "Host=localhost;Port=5433;Database=shop_dev;Password=s3cr3t" } }',
    }),
  );

  it("describes each connection for the first profile's environment and checks it", async () => {
    const { call, checkReachable } = setup(dotnet());
    const status = await call<DbStatus>('status');
    expect(status.dotnet).toEqual({
      environment: 'Development',
      environments: ['Development', 'Production'],
      connections: [
        {
          name: 'Shop',
          file: 'appsettings.Development.json',
          target: { provider: 'postgresql', host: 'localhost', port: 5433, database: 'shop_dev', file: null },
          reach: { result: 'reachable', reason: null },
        },
        {
          // Only one provider is referenced (Npgsql), so it wins over the SQL Server-looking string.
          name: 'Cache',
          file: 'appsettings.json',
          target: { provider: 'postgresql', host: '.\\SQLEXPRESS', port: 5432, database: null, file: null },
          reach: { result: 'reachable', reason: null },
        },
      ],
      truncated: false,
    });
    expect(checkReachable).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(status)).not.toMatch(/s3cr3t|alice/);
  });

  it('reads another environment on request, and skips servers it cannot check', async () => {
    const { call, checkReachable } = setup(dotnet({ dbProviders: ['postgresql', 'sqlserver'] }));
    const status = await call<DbStatus>('status', { environment: 'Production' });
    expect(status.dotnet?.environment).toBe('Production');
    expect(status.dotnet?.connections).toEqual([
      expect.objectContaining({ name: 'Shop', file: 'appsettings.json', target: expect.objectContaining({ host: 'prod.db', database: 'shop' }) }),
      expect.objectContaining({
        name: 'Cache',
        target: expect.objectContaining({ provider: 'sqlserver' }),
        reach: { result: 'not-checked', reason: 'A named instance is found through SQL Browser' },
      }),
    ]);
    expect(checkReachable).toHaveBeenCalledTimes(1);
  });

  it('defaults to Production without launch profiles, and logs counts only', async () => {
    const { call, logger } = setup(dotnet({ launchProfiles: [] }));
    expect((await call<DbStatus>('status')).dotnet).toMatchObject({ environment: 'Production', environments: ['Development', 'Production'] });
    expect(JSON.stringify(logger.entries)).not.toMatch(/s3cr3t|alice|Shop|prod\.db|localhost/);
  });

  it('lists a non-text value as unknown and not checked', async () => {
    await files({ 'appsettings.json': '{ "ConnectionStrings": { "Odd": 42 } }' });
    const { call, checkReachable } = setup(dotnet({ launchProfiles: [] }));
    expect((await call<DbStatus>('status')).dotnet?.connections).toEqual([
      {
        name: 'Odd',
        file: 'appsettings.json',
        target: { provider: 'unknown', host: null, port: null, database: null, file: null },
        reach: { result: 'not-checked', reason: 'Not a text value' },
      },
    ]);
    expect(checkReachable).not.toHaveBeenCalled();
  });

  it('is null for a package without a .NET project', async () => {
    expect((await setup({ prismaSchema: null }).call<DbStatus>('status')).dotnet).toBeNull();
  });

  it('applies to a .NET project without env files or Prisma', () => {
    expect(databaseDefinition.appliesTo(makeDetectedForTest({ ...dotnet() }))).toBe(true);
    expect(databaseDefinition.appliesTo(makeDetectedForTest({ ...dotnet({ project: null, solution: 'Shop.slnx' }) }))).toBe(false);
  });
});

describe('database tool: EF Core', () => {
  const readFixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');
  const efDotnet = (over: Record<string, unknown> = {}): Partial<DetectedProject> => ({
    prismaSchema: null,
    packageJson: null,
    packageManager: null,
    envFiles: [],
    ecosystems: [
      {
        id: 'dotnet',
        info: {
          solution: null,
          project: 'Shop.csproj',
          targetFrameworks: ['net10.0'],
          isWeb: true,
          isTest: false,
          dbProviders: ['postgresql'],
          efDesign: true,
          sdk: null,
          launchProfiles: [{ name: 'http', ports: [5000], environment: 'Development' }],
          ...over,
        },
      },
    ],
  });
  async function efProject(contexts = ['ShopDbContext']) {
    await files({
      'dotnet-tools.json': JSON.stringify({ version: 1, isRoot: true, tools: { 'dotnet-ef': { version: '10.0.0', commands: ['dotnet-ef'] } } }),
      ...Object.fromEntries(contexts.map((c) => [`Data/${c}.cs`, `public class ${c} : DbContext {}`])),
    });
  }
  type Setup = ReturnType<typeof setup>;
  /** Writes stdout to the last spawned child and closes it with code. */
  async function finish(platform: Setup['platform'], code: number, stdout: string) {
    const child = platform.last();
    child.stdout.write(stdout);
    child.exit(code);
    await flushIo();
  }
  const logText = async (call: Setup['call']) => (await call<LogSnapshot>('getLogs', {})).lines.map((l) => l.text);

  it('reports the tool, the contexts and no list before one is read', async () => {
    await efProject(['ShopDbContext', 'AuthContext']);
    const { call } = setup(efDotnet());
    expect((await call<DbStatus>('status', {})).ef).toEqual({
      tool: 'local',
      contexts: ['AuthContext', 'ShopDbContext'],
      context: 'AuthContext',
      needsRestore: false,
      migrations: null,
    });
    expect((await call<DbStatus>('status', { context: 'ShopDbContext' })).ef?.context).toBe('ShopDbContext');
  });

  it('is null without the Design package, and says when no tool is installed', async () => {
    expect((await setup(efDotnet({ efDesign: false })).call<DbStatus>('status', {})).ef).toBeNull();
    const { call } = setup(efDotnet());
    expect((await call<DbStatus>('status', {})).ef?.tool).toBeNull();
    await expect(call('ef', { action: 'list', environment: 'Development' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lists migrations with the environment set, keeps data lines out of the log, and reads the list', async () => {
    await efProject();
    const { call, spawned, platform } = setup(efDotnet());
    await call('ef', { action: 'list', environment: 'Development' });
    const opts = spawned();
    expect(opts?.command).toBe('dotnet');
    expect(opts?.cwd).toBe(root);
    expect(opts?.args).toEqual(['ef', 'migrations', 'list', '--json', '--project', 'Shop.csproj', '--prefix-output', '--', '--environment', 'Development']);
    expect(opts?.env).toMatchObject({ ASPNETCORE_ENVIRONMENT: 'Development', DOTNET_ENVIRONMENT: 'Development', DOTNET_NOLOGO: '1' });
    expect(String(opts?.env.PATH).startsWith(join(root, 'sdk'))).toBe(true);
    expect((await call<DbStatus>('status', {})).running.command).toBe('ef-list');
    await finish(platform, 0, readFixture('ef10-list.txt'));
    const status = await call<DbStatus>('status', {});
    expect(status.running.command).toBeNull();
    expect(status.ef?.migrations).toEqual({
      environment: 'Development',
      items: [
        { id: '20261012151146_Init', name: 'Init', applied: true },
        { id: '20261012151151_AddOrders', name: 'AddOrders', applied: false },
      ],
    });
    const log = await logText(call);
    expect(log[0]).toBe('▸ dotnet ef migrations list --json (Development)');
    expect(log).toContain('Build succeeded.');
    expect(log.some((t) => t.includes('"id"'))).toBe(false);
    expect(log.at(-1)).toBe('■ done');
  });

  it('passes --context only with several contexts', async () => {
    await efProject(['ShopDbContext', 'AuthContext']);
    const { call, spawned, platform } = setup(efDotnet());
    await call('ef', { action: 'list', environment: 'Development' });
    const args = spawned()?.args ?? [];
    expect(args[args.indexOf('--context') + 1]).toBe('AuthContext');
    await finish(platform, 0, '');
    await call('ef', { action: 'script', environment: 'Development', context: 'ShopDbContext' });
    expect(spawned(1)?.args).toContain('ShopDbContext');
  });

  it('passes no --context with a single one', async () => {
    await efProject();
    const { call, spawned } = setup(efDotnet());
    await call('ef', { action: 'list', environment: 'Development' });
    expect(spawned()?.args).not.toContain('--context');
  });

  it('refuses an unknown context or target, a missing name and missing confirmations', async () => {
    await efProject();
    const { call, platform } = setup(efDotnet());
    const refused = (input: object) =>
      expect(call('ef', { environment: 'Development', ...input })).rejects.toMatchObject({ code: 'VALIDATION' });
    await refused({ action: 'list', context: 'Nope' });
    await refused({ action: 'update', target: '20260101000000_X', confirmed: true });
    await refused({ action: 'add' });
    await refused({ action: 'update', environment: 'Production' });
    await refused({ action: 'update', target: '0' });
    await refused({ action: 'remove' });
    expect(platform.spawnCommand).not.toHaveBeenCalled();
  });

  it('runs a confirmed Production update, and restore only for a local tool', async () => {
    await efProject();
    const { call, spawned, platform } = setup(efDotnet());
    await call('ef', { action: 'update', environment: 'Production', confirmed: true });
    expect(spawned()?.args).toEqual(['ef', 'database', 'update', '--project', 'Shop.csproj', '--prefix-output', '--', '--environment', 'Production']);
    expect(spawned()?.env).toMatchObject({ ASPNETCORE_ENVIRONMENT: 'Production' });
    await finish(platform, 1, 'error:   Failed.\n');
    await call('ef', { action: 'restore', environment: 'Development' });
    expect(spawned(1)?.args).toEqual(['tool', 'restore']);
    expect(await logText(call)).toContain('▸ dotnet tool restore');
  });

  it('refuses restore for a global tool', async () => {
    const { call, platform } = setup(efDotnet());
    platform.commandExists.mockResolvedValue(true);
    expect((await call<DbStatus>('status', {})).ef?.tool).toBe('global');
    await expect(call('ef', { action: 'restore', environment: 'Development' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('forgets a list read for another environment', async () => {
    await efProject();
    const { call, platform } = setup(efDotnet());
    await call('ef', { action: 'list', environment: 'Development' });
    await finish(platform, 0, readFixture('ef10-list.txt'));
    expect((await call<DbStatus>('status', { environment: 'Production' })).ef?.migrations).toBeNull();
    await expect(
      call('ef', { action: 'update', environment: 'Production', target: '20261012151146_Init', confirmed: true }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await call('ef', { action: 'update', environment: 'Development', target: '20261012151146_Init', confirmed: true });
  });

  it('lists again after a successful add, but not after a stop or a failure', async () => {
    await efProject();
    const { call, platform, spawned } = setup(efDotnet());
    await call('ef', { action: 'add', environment: 'Development', name: 'AddOrders' });
    expect(spawned()?.args.slice(0, 4)).toEqual(['ef', 'migrations', 'add', 'AddOrders']);
    await finish(platform, 0, 'info:    Done.\n');
    expect(platform.spawnCommand).toHaveBeenCalledTimes(2);
    expect(spawned(1)?.args.slice(0, 3)).toEqual(['ef', 'migrations', 'list']);
    await finish(platform, 0, readFixture('ef10-list.txt'));
    await call('ef', { action: 'add', environment: 'Development', name: 'Again' });
    await call('stop', { what: 'command' });
    await flushIo();
    expect(await logText(call)).toContain('■ stopped');
    await call('ef', { action: 'add', environment: 'Development', name: 'Third' });
    await finish(platform, 1, 'error:   Build failed.\n');
    expect(platform.spawnCommand).toHaveBeenCalledTimes(4);
    expect(await logText(call)).toContain('■ exited with code 1');
  });

  it('keeps the old list when the output is unreadable', async () => {
    await efProject();
    const { call, platform } = setup(efDotnet());
    await call('ef', { action: 'list', environment: 'Development' });
    await finish(platform, 0, readFixture('ef10-list.txt'));
    await call('ef', { action: 'list', environment: 'Development' });
    await finish(platform, 0, 'data:    not json\n');
    expect((await call<DbStatus>('status', {})).ef?.migrations?.items).toHaveLength(2);
    expect(await logText(call)).toContain("■ Couldn't read the migration list");
  });

  it('is CONFLICT while any command runs, and says when dotnet could not start', async () => {
    await efProject();
    const { call, platform } = setup(efDotnet());
    await call('ef', { action: 'list', environment: 'Development' });
    await expect(call('ef', { action: 'script', environment: 'Development' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await finish(platform, 0, '');
    platform.failNextSpawn();
    await call('ef', { action: 'script', environment: 'Development' });
    await flushIo();
    expect(await logText(call)).toContain('■ dotnet could not be started');
  });

  it('flags a local tool that needs restoring, and never logs EF output', async () => {
    await efProject();
    const { call, platform, logger } = setup(efDotnet());
    await call('ef', { action: 'list', environment: 'Development' });
    await finish(platform, 1, `${readFixture('not-restored.txt')}\nerror:   Host=db;Password=s3cr3t\n`);
    expect((await call<DbStatus>('status', {})).ef?.needsRestore).toBe(true);
    expect(await logText(call)).toContain('Host=db;Password=s3cr3t');
    expect(JSON.stringify(logger.entries)).not.toMatch(/s3cr3t|restore|Shop/);
    expect(logger.entries.find((e) => e.message === 'database ef')?.fields).toEqual({ projectId: expect.any(String), action: 'list', code: '1' });
    await call('ef', { action: 'list', environment: 'Development' });
    await finish(platform, 0, readFixture('ef10-list.txt'));
    expect((await call<DbStatus>('status', {})).ef?.needsRestore).toBe(false);
    expect(logger.entries.filter((e) => e.message === 'database ef').at(-1)?.fields).toEqual({
      projectId: expect.any(String),
      action: 'list',
      code: '0',
      migrations: 2,
      pending: 1,
    });
  });

  it('scripts without --idempotent when SQLite is the only provider', async () => {
    await efProject();
    const { call, spawned } = setup(efDotnet({ dbProviders: ['sqlite'] }));
    await call('ef', { action: 'script', environment: 'Development' });
    expect(spawned()?.args).not.toContain('--idempotent');
  });

  it('stops a run after 10 minutes', async () => {
    await efProject();
    const { call, platform } = setup(efDotnet());
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await call('ef', { action: 'update', environment: 'Development' });
      vi.advanceTimersByTime(10 * 60_000);
    } finally {
      vi.useRealTimers();
    }
    await flushIo();
    expect(platform.killTree).toHaveBeenCalled();
    expect(await logText(call)).toContain('■ stopped after 10 minutes');
  });
});
