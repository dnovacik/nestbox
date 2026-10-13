import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { StartAdvice } from '@shared/tools/node/contract';
import { detectNode } from './detect';
import { nodeInfo } from './fixtures';
import { createNodeModule, nodeModule } from './index';
import { nodeTasks } from './tasks';

describe('nodeModule', () => {
  it('detects and lists tasks through detect.ts and tasks.ts', () => {
    expect(nodeModule.id).toBe('node');
    expect(nodeModule.detect).toBe(detectNode);
    expect(nodeModule.tasks).toBe(nodeTasks);
    expect(nodeModule.packageGlobs).toEqual(['*/package.json', '*/*/package.json']);
  });
});

describe('nodeModule.runEnv', () => {
  const platform = {} as never;
  function moduleWith(advice: StartAdvice) {
    const check = {
      status: vi.fn(),
      refresh: vi.fn(),
      forget: vi.fn(),
      advice: vi.fn(async () => advice),
    };
    return { module: createNodeModule({ check }), check };
  }

  it('gives nothing while the Node tool is off (no settings)', async () => {
    const { module, check } = moduleWith({ warning: 'x', pathPrepend: null, note: null });
    expect(await module.runEnv({ dir: '/x', platform, settings: {} }, nodeInfo())).toEqual({});
    expect(check.advice).not.toHaveBeenCalled();
  });

  it("asks the version check for the package, its root and the root's fnm switch", async () => {
    const advice = {
      warning: "Node 18.0.0 doesn't match 20 (.nvmrc)",
      pathPrepend: '/fnm/20/bin',
      note: '▸ fnm: Node 20 from /fnm/20/bin',
    };
    const { module, check } = moduleWith(advice);
    const env = await module.runEnv(
      {
        dir: '/mono/packages/a',
        rootDir: '/mono',
        platform,
        settings: { checkVersions: true, fnm: true },
      },
      nodeInfo({ packageManager: 'pnpm' }),
    );
    expect(check.advice).toHaveBeenCalledWith(
      expect.objectContaining({
        dir: '/mono/packages/a',
        rootDir: '/mono',
        packageManager: 'pnpm',
        lockfiles: [],
        fnm: true,
      }),
    );
    expect(env).toEqual(advice);
  });

  it("passes only a lockfile's manager as the detected one (not the field's, not npm's default)", async () => {
    const { module, check } = moduleWith({ warning: null, pathPrepend: null, note: null });
    const settings = { checkVersions: true, fnm: false };
    await module.runEnv(
      { dir: '/x', platform, settings },
      nodeInfo({ packageManagerSource: 'default' }),
    );
    await module.runEnv(
      { dir: '/x', platform, settings },
      nodeInfo({ packageManager: 'pnpm', packageManagerSource: 'packageManager' }),
    );
    expect(check.advice).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ packageManager: null }),
    );
    expect(check.advice).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ packageManager: null }),
    );
  });

  it('leaves out what the advice has nothing for', async () => {
    const { module } = moduleWith({ warning: null, pathPrepend: null, note: null });
    const settings = { checkVersions: true, fnm: false };
    expect(await module.runEnv({ dir: '/x', platform, settings }, nodeInfo())).toEqual({});
  });
});

describe('nodeModule install hints', () => {
  it('offers install and warns other starts while node_modules is missing, not install/ci themselves', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nestbox-node-install-'));
    const info = nodeInfo({ lockfiles: [], hasDependencies: true });
    expect(await nodeModule.installHint?.({ dir, rootDir: null }, info)).toEqual({
      state: 'missing',
      task: 'install',
    });
    const check = {
      status: vi.fn(),
      refresh: vi.fn(),
      forget: vi.fn(),
      advice: vi.fn(async () => ({ warning: 'Node is old', pathPrepend: null, note: null })),
    };
    const module = createNodeModule({ check });
    const settings = { checkVersions: true, fnm: false };
    expect(await module.runEnv({ dir, platform: {} as never, settings }, info)).toEqual({
      warning: "Node is old; Dependencies aren't installed (run install)",
    });
    expect(
      await module.runEnv({ dir, platform: {} as never, settings, task: 'install' }, info),
    ).toEqual({ warning: 'Node is old' });
    await mkdir(join(dir, 'node_modules'));
    expect(await nodeModule.installHint?.({ dir, rootDir: null }, info)).toBeNull();
  });
});

describe('nodeModule.ports', () => {
  it("gives detection's ports to Health and the Inspector", () => {
    expect(nodeModule.ports?.(nodeInfo({ ports: [3001, 5173] }))).toEqual([3001, 5173]);
  });
});

describe('nodeModule.summary', () => {
  it('names the package manager', () => {
    expect(nodeModule.summary?.(nodeInfo({ packageManager: 'yarn' }))).toBe('Node.js · yarn');
    expect(
      nodeModule.summary?.(
        nodeInfo({ packageManager: 'yarn', lockfiles: ['yarn.lock', 'package-lock.json'] }),
      ),
    ).toBe('Node.js · yarn · 2 lockfiles');
    expect(
      nodeModule.summary?.(
        nodeInfo({ packageManager: 'pnpm', framework: { id: 'next', major: 15 } }),
      ),
    ).toBe('Node.js · pnpm · Next.js 15');
  });
});
