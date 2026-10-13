import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeInfo } from './fixtures';
import { detectMonorepo, monorepoTasks } from './monorepo';

async function tree(files: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nestbox-mono-'));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name, '..'), { recursive: true });
    await writeFile(
      join(dir, name),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  }
  return dir;
}

describe('detectMonorepo', () => {
  it('finds the script names two or more workspace packages define', async () => {
    const root = { name: 'mono', workspaces: ['packages/*'] };
    const dir = await tree({
      'package.json': root,
      'packages/a/package.json': { scripts: { build: 'tsc', test: 'vitest', dev: 'vite' } },
      'packages/b/package.json': { scripts: { build: 'tsc', test: 'vitest', 'odd name': 'x' } },
      'packages/c/package.json': { scripts: { lint: 'eslint .', 'odd name': 'y' } },
    });
    expect(await detectMonorepo(dir, new Set(['package.json']), root)).toEqual({
      shared: ['build', 'test'],
      turbo: [],
      yarnBerry: false,
    });
  });

  it("reads turbo.json's tasks (v2) or pipeline (v1) when turbo is a root dependency", async () => {
    const root = { workspaces: ['apps/*'], devDependencies: { turbo: '^2.3.0' } };
    const dir = await tree({
      'package.json': root,
      'turbo.json':
        '{\n  // comments are allowed\n  "tasks": { "build": {}, "dev": { "cache": false }, "web#build": {}, "//#lint": {} }\n}',
      'apps/web/package.json': { scripts: { build: 'next build' } },
    });
    const files = new Set(['package.json', 'turbo.json']);
    expect((await detectMonorepo(dir, files, root))?.turbo).toEqual(['build', 'dev']);
    await writeFile(join(dir, 'turbo.json'), '{"pipeline":{"test":{}}}');
    expect((await detectMonorepo(dir, files, root))?.turbo).toEqual(['test']);
    // Without turbo installed at the root nothing is offered: running it would download it.
    expect((await detectMonorepo(dir, files, { workspaces: ['apps/*'] }))?.turbo).toEqual([]);
  });

  it('knows Yarn 2+ by .yarnrc.yml, and is null without declared workspaces', async () => {
    const root = { workspaces: ['packages/*'] };
    const dir = await tree({ 'package.json': root, '.yarnrc.yml': 'nodeLinker: node-modules\n' });
    expect(
      (await detectMonorepo(dir, new Set(['package.json', '.yarnrc.yml']), root))?.yarnBerry,
    ).toBe(true);
    const single = await tree({ 'package.json': { name: 'app' } });
    expect(await detectMonorepo(single, new Set(['package.json']), { name: 'app' })).toBeNull();
  });
});

describe('monorepoTasks', () => {
  const monorepo = { shared: ['build'], turbo: ['build', 'dev'], yarnBerry: false };

  it.each([
    ['pnpm', false, ['pnpm', '-r', 'run', 'build']],
    ['npm', false, ['npm', 'run', 'build', '--workspaces', '--if-present']],
    ['yarn', false, ['yarn', 'workspaces', 'run', 'build']],
    ['yarn', true, ['yarn', 'workspaces', 'foreach', '-A', 'run', 'build']],
    ['bun', false, ['bun', 'run', '--filter', '*', 'build']],
  ] as const)(
    '%s (berry %s) runs a shared script in every package',
    (packageManager, yarnBerry, argv) => {
      const tasks = monorepoTasks(
        nodeInfo({ packageManager, monorepo: { ...monorepo, turbo: [], yarnBerry } }),
      );
      expect(tasks).toEqual([
        { name: 'all:build', argv: [...argv], title: 'Run build in every package' },
      ]);
    },
  );

  it('runs turbo through the package manager, never a download', () => {
    expect(
      monorepoTasks(nodeInfo({ packageManager: 'npm', monorepo: { ...monorepo, shared: [] } })),
    ).toEqual([
      {
        name: 'turbo:build',
        argv: ['npm', 'exec', '--no', '--', 'turbo', 'run', 'build'],
        title: 'turbo run build',
      },
      {
        name: 'turbo:dev',
        argv: ['npm', 'exec', '--no', '--', 'turbo', 'run', 'dev'],
        title: 'turbo run dev',
      },
    ]);
    expect(
      monorepoTasks(
        nodeInfo({
          packageManager: 'pnpm',
          monorepo: { ...monorepo, shared: [], turbo: ['lint'] },
        }),
      )[0]?.argv,
    ).toEqual(['pnpm', 'exec', 'turbo', 'run', 'lint']);
  });

  it('has none outside a monorepo root', () => {
    expect(monorepoTasks(nodeInfo())).toEqual([]);
  });
});
