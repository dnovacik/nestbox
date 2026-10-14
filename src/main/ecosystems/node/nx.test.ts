import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isNxRoot, nxProjectDirs, nxRootTargets, readNxProject } from './nx';

async function tree(files: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nestbox-nx-'));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name, '..'), { recursive: true });
    await writeFile(
      join(dir, name),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  }
  return dir;
}

const ROOT_PKG = { name: 'acme', devDependencies: { nx: '20.1.0' } };

describe('isNxRoot', () => {
  it('needs nx.json and nx installed at the root', () => {
    expect(isNxRoot(new Set(['package.json', 'nx.json']), ROOT_PKG)).toBe(true);
    expect(isNxRoot(new Set(['package.json', 'nx.json']), { dependencies: { nx: '^20' } })).toBe(
      true,
    );
    // Running nx without it installed would download it.
    expect(isNxRoot(new Set(['package.json', 'nx.json']), { name: 'acme' })).toBe(false);
    expect(isNxRoot(new Set(['package.json']), ROOT_PKG)).toBe(false);
    expect(isNxRoot(new Set(['nx.json']), null)).toBe(false);
  });
});

describe('nxProjectDirs', () => {
  it('lists folders with a project.json up to four levels down, skipping dependencies and output', async () => {
    const dir = await tree({
      'package.json': ROOT_PKG,
      'nx.json': {},
      'apps/web/project.json': {},
      'libs/shared/ui/project.json': {},
      'libs/a/b/c/project.json': {},
      'libs/a/b/c/d/project.json': {},
      'node_modules/x/project.json': {},
      'dist/apps/web/project.json': {},
      '.nx/cache/project.json': {},
    });
    expect(await nxProjectDirs(dir)).toEqual(['apps/web', 'libs/a/b/c', 'libs/shared/ui']);
  });

  it('is empty outside an Nx root', async () => {
    const dir = await tree({ 'package.json': { name: 'x' }, 'apps/web/project.json': {} });
    expect(await nxProjectDirs(dir)).toEqual([]);
  });
});

describe('readNxProject', () => {
  it("reads the project's name and plain target names", async () => {
    const dir = await tree({
      'project.json':
        '{ // jsonc\n "name": "web", "targets": { "build": {}, "serve": {}, "build:prod": {}, "{weird}": {}, "^dep": {} } }',
    });
    expect(await readNxProject(dir, null)).toEqual({
      project: 'web',
      targets: ['build', 'build:prod', 'serve'],
    });
  });

  it("falls back to package.json's name, and refuses names that aren't npm-style", async () => {
    const dir = await tree({ 'project.json': { targets: { test: {} } } });
    expect(await readNxProject(dir, '@acme/ui')).toEqual({
      project: '@acme/ui',
      targets: ['test'],
    });
    expect(await readNxProject(dir, null)).toBeNull();
    await writeFile(join(dir, 'project.json'), JSON.stringify({ name: 'a b & c', targets: {} }));
    expect(await readNxProject(dir, null)).toBeNull();
  });

  it('is null without a readable project.json', async () => {
    const dir = await tree({ 'project.json': '[1]' });
    expect(await readNxProject(dir, 'x')).toBeNull();
    expect(await readNxProject(join(dir, 'missing'), 'x')).toBeNull();
  });
});

describe('nxRootTargets', () => {
  it("joins nx.json's targetDefaults with the projects' targets, sorted and capped", async () => {
    const dir = await tree({
      'package.json': ROOT_PKG,
      'nx.json': '{ "targetDefaults": { "build": {}, "@nx/vite:test": {}, "lint": {} } }',
      'apps/web/project.json': { name: 'web', targets: { serve: {}, build: {} } },
      'libs/ui/project.json': { name: 'ui', targets: { storybook: {} } },
    });
    expect(await nxRootTargets(dir, ['apps/web', 'libs/ui'])).toEqual([
      'build',
      'lint',
      'serve',
      'storybook',
    ]);
  });
});
