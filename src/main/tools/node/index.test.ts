import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { DetectedProject } from '@shared/detected';
import { NestboxError } from '@shared/errors';
import { makeDetectedForTest } from '@shared/test-fixtures';
import type { NodeSettings, NodeStatus, StartAdvice } from '@shared/tools/node/contract';
import { createMemoryLogger } from '../../logger';
import { fakePlatform } from '../../processes/fake-child';
import { createSharedContext } from '../shared-context';
import type { ToolContext } from '../types';
import { createNodeTool } from './index';

type Exec = Record<string, { code: number | null; stdout: string }>;

interface Setup {
  files?: Record<string, string>;
  rootFiles?: Record<string, string>;
  packageJson?: Record<string, unknown>;
  rootPackageJson?: Record<string, unknown>;
  workspace?: boolean;
  exec?: Exec;
  commands?: string[];
  platformId?: 'win32' | 'darwin';
  shellEnv?: NodeJS.ProcessEnv;
  settings?: Partial<NodeSettings>;
  packageManager?: DetectedProject['packageManager'];
}

async function setup(o: Setup = {}) {
  const rootPath = await mkdtemp(join(tmpdir(), 'nestbox-node-'));
  const pkgPath = o.workspace ? join(rootPath, 'packages', 'api') : rootPath;
  await mkdir(pkgPath, { recursive: true });
  for (const [name, text] of Object.entries(o.rootFiles ?? {})) await writeFile(join(rootPath, name), text);
  for (const [name, text] of Object.entries(o.files ?? {})) await writeFile(join(pkgPath, name), text);
  // Detection keeps only name and scripts: the tool reads package.json itself.
  const rootJson = { name: 'shop', ...(o.workspace ? o.rootPackageJson : o.packageJson) };
  await writeFile(join(rootPath, 'package.json'), JSON.stringify(rootJson));
  if (o.workspace) await writeFile(join(pkgPath, 'package.json'), JSON.stringify({ name: '@shop/api', ...o.packageJson }));

  const root = makeDetectedForTest({
    id: 'r1',
    rootId: 'r1',
    path: rootPath,
    packageJson: { name: 'shop', scripts: {} },
    packageManager: o.packageManager ?? 'pnpm',
  });
  const project = o.workspace
    ? makeDetectedForTest({
        id: 'r1::packages/api',
        rootId: 'r1',
        relPath: 'packages/api',
        path: pkgPath,
        packageJson: { name: '@shop/api', scripts: {} },
        packageManager: o.packageManager ?? 'pnpm',
      })
    : root;

  const exec: Exec = { 'node --version': { code: 0, stdout: 'v20.11.1\n' }, ...o.exec };
  const base = fakePlatform();
  const platform = {
    ...base,
    id: o.platformId ?? 'darwin',
    execCommand: vi.fn(async (command: string, args: readonly string[], _opts: { env?: Record<string, string> }) => {
      return exec[`${command} ${args.join(' ')}`] ?? { code: 1, stdout: '' };
    }),
    commandExists: vi.fn(async (command: string) => (o.commands ?? []).includes(command)),
    resolveShellEnv: vi.fn(async () => o.shellEnv ?? {}),
  };
  let settings: NodeSettings = { fnm: false, ...o.settings };
  const logger = createMemoryLogger();
  const tool = createNodeTool({
    logger,
    getDetected: (id) => {
      if (id === 'r1') return root;
      throw new NestboxError('NOT_FOUND', 'Project not found');
    },
  });
  const ctx = {
    project,
    shared: createSharedContext().forProject(project.id),
    emit: vi.fn(),
    platform,
    settings: {
      get: () => settings,
      update: (fn: (s: NodeSettings) => NodeSettings) => (settings = fn(settings)),
    },
  } as unknown as ToolContext<NodeSettings>;
  const call = <T>(method: string, input: unknown = {}) => tool.handlers[method]?.(ctx, input) as Promise<T>;
  const execs = () => platform.execCommand.mock.calls.map(([c, a]) => `${c} ${a.join(' ')}`);
  return { call, platform, execs, logger, rootPath };
}

describe('node tool: requirement', () => {
  it('takes the first source, flags the ones that disagree, and compares the running Node', async () => {
    const { call } = await setup({ files: { '.nvmrc': '18\n' }, packageJson: { engines: { node: '>=20' } } });
    const status = await call<NodeStatus>('status');
    expect(status.requirement).toBe('nvmrc');
    expect(status.sources).toEqual([
      { kind: 'nvmrc', value: '18', fromRoot: false, valid: true, conflict: false },
      { kind: 'engines', value: '>=20', fromRoot: false, valid: true, conflict: true },
    ]);
    expect(status.node).toEqual({ version: 'v20.11.1', ok: false });
    expect(status.state).toBe('mismatch');
  });

  it('is ok when the running Node satisfies the requirement', async () => {
    const { call } = await setup({ files: { '.node-version': 'v20.11.1' }, packageJson: { volta: { node: '20.11.1' } } });
    expect(await call<NodeStatus>('status')).toMatchObject({ state: 'ok', requirement: 'node-version', node: { ok: true } });
  });

  it('says conflict when the sources disagree but the running Node is fine', async () => {
    const { call } = await setup({ files: { '.nvmrc': '20' }, packageJson: { engines: { node: '>=22' } } });
    expect(await call<NodeStatus>('status')).toMatchObject({ state: 'conflict', node: { ok: true } });
  });

  it('lets a workspace package inherit the root version file and engines', async () => {
    const { call } = await setup({
      workspace: true,
      rootFiles: { '.nvmrc': '20' },
      rootPackageJson: { engines: { node: '>=20' } },
    });
    const status = await call<NodeStatus>('status');
    expect(status.sources).toEqual([
      { kind: 'nvmrc', value: '20', fromRoot: true, valid: true, conflict: false },
      { kind: 'engines', value: '>=20', fromRoot: true, valid: true, conflict: false },
    ]);
    expect(status.state).toBe('ok');
  });

  it('is unknown without a requirement or with an alias, and marks unreadable sources', async () => {
    expect(await (await setup()).call<NodeStatus>('status')).toMatchObject({ state: 'unknown', requirement: null, node: { ok: null } });
    const alias = await setup({ files: { '.nvmrc': 'lts/*' } });
    expect(await alias.call<NodeStatus>('status')).toMatchObject({ state: 'unknown', requirement: 'nvmrc', node: { ok: null } });
    const big = await setup({ files: { '.nvmrc': `20${' '.repeat(2_000)}` }, packageJson: { engines: { node: 'banana' } } });
    expect((await big.call<NodeStatus>('status')).sources).toEqual([
      { kind: 'nvmrc', value: null, fromRoot: false, valid: false, conflict: false },
      { kind: 'engines', value: 'banana', fromRoot: false, valid: false, conflict: false },
    ]);
  });

  it('reports Node as missing when node --version fails', async () => {
    const { call } = await setup({ files: { '.nvmrc': '20' }, exec: { 'node --version': { code: 1, stdout: '' } } });
    expect(await call<NodeStatus>('status')).toMatchObject({ state: 'unknown', node: { version: null, ok: null } });
  });
});

describe('node tool: package manager', () => {
  it('compares packageManager with the lockfile and the installed version, with Corepack offline', async () => {
    const { call, platform } = await setup({
      packageJson: { packageManager: 'pnpm@10.30.2+sha512.abc' },
      exec: { 'pnpm --version': { code: 0, stdout: '10.30.2\n' } },
    });
    expect((await call<NodeStatus>('status')).packageManager).toEqual({
      name: 'pnpm',
      version: '10.30.2',
      detected: 'pnpm',
      installed: '10.30.2',
      ok: true,
    });
    const pnpmCall = platform.execCommand.mock.calls.find(([c]) => c === 'pnpm');
    expect(pnpmCall?.[2]).toMatchObject({ env: { COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' } });
  });

  it('is a mismatch when the installed version or the lockfile differs', async () => {
    const older = await setup({
      packageJson: { packageManager: 'pnpm@10.30.2' },
      exec: { 'pnpm --version': { code: 0, stdout: '9.15.0' } },
    });
    expect(await older.call<NodeStatus>('status')).toMatchObject({ state: 'mismatch', packageManager: { ok: false } });
    const other = await setup({
      packageManager: 'npm',
      packageJson: { packageManager: 'pnpm@10.30.2' },
      exec: { 'pnpm --version': { code: 0, stdout: '10.30.2' } },
    });
    expect(await other.call<NodeStatus>('status')).toMatchObject({
      packageManager: { detected: 'npm', ok: false },
    });
  });

  it('leaves the version unknown when the package manager cannot run', async () => {
    const { call } = await setup({ packageJson: { packageManager: 'yarn@4.5.1' }, packageManager: 'yarn' });
    expect((await call<NodeStatus>('status')).packageManager).toMatchObject({ installed: null, ok: null });
  });
});

describe('node tool: version managers and fnm', () => {
  it('names the version manager it finds', async () => {
    expect((await (await setup({ commands: ['volta'] })).call<NodeStatus>('status')).manager).toBe('volta');
    expect((await (await setup({ commands: ['nvm'], platformId: 'win32' })).call<NodeStatus>('status')).manager).toBe(
      'nvm-windows',
    );
    expect((await (await setup({ shellEnv: { NVM_DIR: '/home/u/.nvm' } })).call<NodeStatus>('status')).manager).toBe('nvm');
    expect((await (await setup()).call<NodeStatus>('status')).manager).toBeNull();
  });

  it('offers fnm when it is found and the requirement gives it a version', async () => {
    const found = await setup({ commands: ['fnm'], files: { '.nvmrc': '20' } });
    expect((await found.call<NodeStatus>('status')).fnm).toEqual({ available: true, on: false, version: '20' });
    const alias = await setup({ commands: ['fnm'], files: { '.nvmrc': 'node' } });
    expect((await alias.call<NodeStatus>('status')).fnm).toEqual({ available: false, on: false, version: null });
  });

  it('with the switch on, checks and runs the Node fnm provides', async () => {
    const { call, execs } = await setup({
      commands: ['fnm'],
      files: { '.nvmrc': '18' },
      exec: {
        'fnm exec --using=18 node --version': { code: 0, stdout: 'v18.20.4\n' },
        'fnm exec --using=18 node -p process.execPath': { code: 0, stdout: '/fnm/node-versions/v18.20.4/installation/bin/node\n' },
      },
    });
    expect(await call<NodeStatus>('status')).toMatchObject({ node: { version: 'v20.11.1', ok: false } });
    expect(await call<NodeStatus>('setFnm', { enabled: true })).toMatchObject({
      state: 'ok',
      node: { version: 'v18.20.4', ok: true },
      fnm: { on: true },
    });
    expect(await call<StartAdvice>('startAdvice')).toEqual({
      warning: null,
      pathPrepend: '/fnm/node-versions/v18.20.4/installation/bin',
      note: '▸ fnm: Node 18 from /fnm/node-versions/v18.20.4/installation/bin',
    });
    await call('startAdvice');
    expect(execs().filter((e) => e.endsWith('process.execPath'))).toHaveLength(1);
  });

  it('says so when fnm cannot provide the version, and starts with the normal PATH', async () => {
    const { call } = await setup({ commands: ['fnm'], files: { '.nvmrc': '18' }, settings: { fnm: true } });
    expect(await call<StartAdvice>('startAdvice')).toEqual({
      warning: "Node isn't 18 (.nvmrc): fnm couldn't provide it",
      pathPrepend: null,
      note: "▲ fnm couldn't provide Node 18 (is it installed? fnm install 18)",
    });
  });
});

describe('node tool: advice and cache', () => {
  it('warns about a Node or package manager mismatch before a start', async () => {
    const node = await setup({ files: { '.nvmrc': '18' } });
    expect(await node.call<StartAdvice>('startAdvice')).toEqual({
      warning: "Node v20.11.1 doesn't match 18 (.nvmrc)",
      pathPrepend: null,
      note: null,
    });
    const pm = await setup({
      packageJson: { packageManager: 'pnpm@10.30.2' },
      exec: { 'pnpm --version': { code: 0, stdout: '9.15.0' } },
    });
    expect((await pm.call<StartAdvice>('startAdvice')).warning).toBe("pnpm 9.15.0 doesn't match packageManager pnpm@10.30.2");
    expect(await (await setup({ files: { '.nvmrc': '20' } })).call<StartAdvice>('startAdvice')).toEqual({
      warning: null,
      pathPrepend: null,
      note: null,
    });
  });

  it('caches a check for 30 s; refresh runs it again', async () => {
    const { call, execs } = await setup({ files: { '.nvmrc': '20' } });
    await call('status');
    await call('status');
    expect(execs().filter((e) => e === 'node --version')).toHaveLength(1);
    await call('refresh');
    expect(execs().filter((e) => e === 'node --version')).toHaveLength(2);
  });
});
