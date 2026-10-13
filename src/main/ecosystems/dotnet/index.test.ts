import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTree, removeTree } from '../../detection/test-fixtures';
import type { PlatformAdapter } from '../../platform/adapter';
import { createDotnetModule, DOTNET_ENV, type DotnetInfo } from './index';

let dir = '';
afterEach(async () => removeTree(dir));

const info = (over: Partial<DotnetInfo> = {}): DotnetInfo => ({
  solution: null,
  project: 'Api.csproj',
  targetFrameworks: ['net8.0'],
  isWeb: true,
  isTest: false,
  dbProviders: [],
  efDesign: false,
  sdk: null,
  launchProfiles: [],
  ...over,
});

function platform(opts: { onPath?: boolean | null; sdks?: string; code?: number } = {}) {
  const execCommand = vi.fn(async () => ({
    code: opts.code ?? 0,
    stdout: opts.sdks ?? '8.0.414 [C:\\dotnet\\sdk]\r\n',
  }));
  const commandExists = vi.fn(async () => opts.onPath ?? true);
  return {
    platform: { execCommand, commandExists } as unknown as PlatformAdapter,
    execCommand,
    commandExists,
  };
}

describe('dotnet module', () => {
  it('lists its tasks through tasks.ts', () => {
    expect(createDotnetModule().tasks(info()).map((t) => t.name)).toEqual(['run', 'watch', 'build', 'restore', 'clean']);
  });
});

describe('dotnet runEnv', () => {
  it('turns off telemetry and banners', async () => {
    const { platform: p, execCommand } = platform();
    expect(
      await createDotnetModule().runEnv({ dir: '/x', platform: p, settings: {} }, info()),
    ).toEqual({ env: DOTNET_ENV });
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('warns when no installed SDK satisfies global.json, and caches the SDK list for 30 s', async () => {
    let now = 1_000;
    const module = createDotnetModule({ now: () => now, home: '/home/u' });
    const { platform: p, execCommand } = platform({
      sdks: '8.0.414 [C:\\dotnet\\sdk]\r\n10.0.401 [C:\\dotnet\\sdk]\r\n',
    });
    const pinned = info({ sdk: { version: '9.0.100', rollForward: 'latestFeature' } });
    const env = await module.runEnv({ dir: '/x', platform: p, settings: {} }, pinned);
    expect(env.warning).toBe(
      'global.json asks for .NET SDK 9.0.100 (rollForward latestFeature); installed: 8.0.414, 10.0.401',
    );
    expect(execCommand).toHaveBeenCalledWith(
      'dotnet',
      ['--list-sdks'],
      expect.objectContaining({ cwd: '/x', env: DOTNET_ENV }),
    );
    now += 29_000;
    await module.runEnv({ dir: '/x', platform: p, settings: {} }, pinned);
    expect(execCommand).toHaveBeenCalledTimes(1);
    now += 2_000;
    await module.runEnv({ dir: '/x', platform: p, settings: {} }, pinned);
    expect(execCommand).toHaveBeenCalledTimes(2);
  });

  it('says nothing about the SDK when --list-sdks fails', async () => {
    const { platform: p } = platform({ code: 1 });
    const env = await createDotnetModule().runEnv(
      { dir: '/x', platform: p, settings: {} },
      info({ sdk: { version: '9.0.100', rollForward: 'disable' } }),
    );
    expect(env.warning).toBeUndefined();
  });

  it('uses ~/.dotnet when dotnet is not on PATH', async () => {
    dir = await makeTree({ '.dotnet/dotnet': '' });
    const { platform: p } = platform({ onPath: false });
    const env = await createDotnetModule({ now: Date.now, home: dir }).runEnv(
      { dir: '/x', platform: p, settings: {} },
      info(),
    );
    expect(env).toEqual({
      env: DOTNET_ENV,
      pathPrepend: join(dir, '.dotnet'),
      note: `Using the .NET SDK in ${join(dir, '.dotnet')}`,
    });
  });

  it('warns when dotnet is nowhere', async () => {
    dir = await makeTree({ 'x.txt': '' });
    const { platform: p } = platform({ onPath: false });
    const env = await createDotnetModule({ now: Date.now, home: dir }).runEnv(
      { dir: '/x', platform: p, settings: {} },
      info(),
    );
    expect(env.warning).toBe("dotnet isn't on PATH: install the .NET SDK");
  });
});

describe('dotnet ports and summary', () => {
  const module = createDotnetModule();

  it('lists the launch profiles http ports once', () => {
    expect(
      module.ports?.(
        info({
          launchProfiles: [
            { name: 'http', ports: [5283], environment: 'Production' },
            { name: 'https', ports: [5283, 5000], environment: 'Production' },
          ],
        }),
      ),
    ).toEqual([5283, 5000]);
  });

  it('summarises frameworks, kind and SDK', () => {
    expect(
      module.summary?.(info({ sdk: { version: '8.0.100', rollForward: 'latestPatch' } })),
    ).toBe('.NET · net8.0 · web · SDK 8.0.100');
    expect(
      module.summary?.(
        info({ solution: 'Shop.sln', project: null, targetFrameworks: [], isWeb: false }),
      ),
    ).toBe('.NET · solution');
  });
});
