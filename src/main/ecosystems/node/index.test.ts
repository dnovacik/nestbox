import { describe, expect, it, vi } from 'vitest';
import type { StartAdvice } from '@shared/tools/node/contract';
import { detectNode } from './detect';
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
    expect(
      await module.runEnv({ dir: '/x', platform, settings: {} }, { packageManager: 'npm' }),
    ).toEqual({});
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
      { packageManager: 'pnpm' },
    );
    expect(check.advice).toHaveBeenCalledWith(
      expect.objectContaining({
        dir: '/mono/packages/a',
        rootDir: '/mono',
        packageManager: 'pnpm',
        fnm: true,
      }),
    );
    expect(env).toEqual(advice);
  });

  it('leaves out what the advice has nothing for', async () => {
    const { module } = moduleWith({ warning: null, pathPrepend: null, note: null });
    const settings = { checkVersions: true, fnm: false };
    expect(
      await module.runEnv({ dir: '/x', platform, settings }, { packageManager: 'npm' }),
    ).toEqual({});
  });
});

describe('nodeModule.summary', () => {
  it('names the package manager', () => {
    expect(nodeModule.summary?.({ packageManager: 'yarn' })).toBe('Node.js · yarn');
  });
});
