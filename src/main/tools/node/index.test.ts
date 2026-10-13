import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { NestboxError } from '@shared/errors';
import { makeDetectedForTest } from '@shared/test-fixtures';
import type { NodeSettings, NodeStatus, StartAdvice } from '@shared/tools/node/contract';
import { createMemoryLogger } from '../../logger';
import { fakePlatform } from '../../processes/fake-child';
import { createSharedContext } from '../shared-context';
import type { ToolContext } from '../types';
import { createNodeTool } from './index';

// The tool's own job: which package and root it checks, the fnm switch, logging. The check itself is tested
// in ecosystems/node/version-check.test.ts.
async function setup(
  o: {
    rootKnown?: boolean;
    commands?: string[];
    platformId?: 'win32' | 'darwin';
    nvmrc?: string | null;
    packageJson?: Record<string, unknown>;
  } = {},
) {
  const rootPath = await mkdtemp(join(tmpdir(), 'nestbox-node-tool-'));
  const pkgPath = join(rootPath, 'packages', 'api');
  await mkdir(pkgPath, { recursive: true });
  if (o.nvmrc !== null) await writeFile(join(rootPath, '.nvmrc'), o.nvmrc ?? '18\n');
  await writeFile(join(rootPath, 'package.json'), '{"name":"shop"}');
  await writeFile(
    join(pkgPath, 'package.json'),
    JSON.stringify({ name: '@shop/api', ...o.packageJson }),
  );
  const root = makeDetectedForTest({
    id: 'r1',
    rootId: 'r1',
    path: rootPath,
    packageManager: 'pnpm',
  });
  const project = makeDetectedForTest({
    id: 'r1::packages/api',
    rootId: 'r1',
    relPath: 'packages/api',
    path: pkgPath,
    packageManager: 'pnpm',
  });
  const exec: Record<string, { code: number; stdout: string }> = {
    'node --version': { code: 0, stdout: 'v20.11.1\n' },
    'fnm exec --using=18 node --version': { code: 0, stdout: 'v18.20.4\n' },
    'fnm exec --using=18 node -p process.execPath': { code: 0, stdout: '/fnm/18/bin/node\n' },
  };
  const platform = {
    ...fakePlatform(),
    id: o.platformId ?? 'darwin',
    openTerminal: vi.fn(async (_cwd: string, _command?: string) => {}),
    execCommand: vi.fn(
      async (command: string, args: readonly string[]) =>
        exec[`${command} ${args.join(' ')}`] ?? { code: 1, stdout: '' },
    ),
    commandExists: vi.fn(async (command: string) => (o.commands ?? []).includes(command)),
    resolveShellEnv: vi.fn(async () => ({})),
  };
  let settings: NodeSettings = { fnm: false };
  const logger = createMemoryLogger();
  const clipboard = { writeText: vi.fn((_text: string) => {}) };
  const tool = createNodeTool({
    logger,
    clipboard,
    getDetected: (id) => {
      if (id === 'r1' && o.rootKnown !== false) return root;
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
  const call = <T>(method: string, input: unknown = {}) =>
    tool.handlers[method]?.(ctx, input) as Promise<T>;
  const nodeRuns = () => platform.execCommand.mock.calls.filter(([c]) => c === 'node').length;
  return {
    call,
    tool,
    logger,
    nodeRuns,
    settings: () => settings,
    platform,
    clipboard,
    rootPath,
    pkgPath,
  };
}

describe('node tool', () => {
  it("checks a workspace package with its root's version file, and logs the state only", async () => {
    const { call, logger } = await setup();
    const status = await call<NodeStatus>('status');
    expect(status).toMatchObject({
      state: 'mismatch',
      requirement: 'nvmrc',
      node: { version: 'v20.11.1', ok: false },
    });
    expect(status.sources[0]).toMatchObject({ kind: 'nvmrc', fromRoot: true });
    expect(logger.entries.find((e) => e.message === 'node check')?.fields).toEqual({
      projectId: 'r1::packages/api',
      state: 'mismatch',
      ms: expect.any(Number),
    });
  });

  it('checks the package alone when its root is unknown', async () => {
    const { call } = await setup({ rootKnown: false });
    expect(await call<NodeStatus>('status')).toMatchObject({ state: 'unknown', sources: [] });
  });

  it('stores the fnm switch on the root project and starts with its Node', async () => {
    const { call, settings } = await setup({ commands: ['fnm'] });
    expect(await call<NodeStatus>('setFnm', { enabled: true })).toMatchObject({
      fnm: { on: true, version: '18' },
      node: { version: 'v18.20.4', ok: true },
    });
    expect(settings().fnm).toBe(true);
    expect(await call<StartAdvice>('startAdvice')).toMatchObject({
      pathPrepend: dirname('/fnm/18/bin/node'),
    });
  });

  it('checks again after refresh and after a project is removed', async () => {
    const { call, tool, nodeRuns } = await setup();
    await call('status');
    await call('status');
    expect(nodeRuns()).toBe(1);
    await call('refresh');
    expect(nodeRuns()).toBe(2);
    tool.forgetProject?.('r1');
    await call('status');
    expect(nodeRuns()).toBe(3);
  });

  it('installs the required Node with fnm in a terminal when it does not match', async () => {
    const { call, platform, pkgPath } = await setup({ commands: ['fnm'] });
    expect((await call<NodeStatus>('status')).fixes).toMatchObject({
      fnmInstall: '18',
      nvm: null,
      nvmrc: null,
    });
    await call('fnmInstall');
    expect(platform.openTerminal).toHaveBeenCalledWith(pkgPath, 'fnm install 18');
  });

  it('copies the nvm commands (nvm-windows only for plain versions)', async () => {
    const { call, clipboard } = await setup({ commands: ['nvm'], platformId: 'win32' });
    expect((await call<NodeStatus>('status')).fixes.nvm).toBe('nvm install 18 && nvm use 18');
    await call('copyNvmCommand');
    expect(clipboard.writeText).toHaveBeenCalledWith('nvm install 18 && nvm use 18');
    const codename = await setup({
      commands: ['nvm'],
      platformId: 'win32',
      nvmrc: 'lts/hydrogen\n',
    });
    expect((await codename.call<NodeStatus>('status')).fixes.nvm).toBeNull();
  });

  it("creates the root's .nvmrc from engines.node, once", async () => {
    const { call, rootPath } = await setup({
      nvmrc: null,
      packageJson: { engines: { node: '>=20.9' } },
    });
    expect((await call<NodeStatus>('status')).fixes.nvmrc).toBe('20');
    const after = await call<NodeStatus>('createNvmrc');
    expect(await readFile(join(rootPath, '.nvmrc'), 'utf8')).toBe('20\n');
    expect(after.sources[0]).toMatchObject({ kind: 'nvmrc', value: '20', fromRoot: true });
    expect(after.fixes.nvmrc).toBeNull();
    await expect(call('createNvmrc')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it("offers the running Node's major for .nvmrc without any requirement, and nothing to run", async () => {
    const { call } = await setup({ nvmrc: null, commands: ['fnm'] });
    expect((await call<NodeStatus>('status')).fixes).toEqual({
      fnmInstall: null,
      nvm: null,
      nvmrc: '20',
    });
    await expect(call('fnmInstall')).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
