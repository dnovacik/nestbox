import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTree, removeTree } from '../../detection/test-fixtures';
import { nodeWorkspaces } from './workspaces';

let dir = '';
afterEach(async () => removeTree(dir));

const PKG = '{"name":"x"}';
const root = (workspaces: unknown) => JSON.stringify({ name: 'root', workspaces });

describe('nodeWorkspaces', () => {
  it('is null when neither pnpm-workspace.yaml nor package.json declares workspaces', async () => {
    dir = await makeTree({ 'package.json': PKG, 'app/package.json': PKG });
    expect(await nodeWorkspaces(dir)).toBeNull();
  });

  it('is null without a package.json, and for one that is not JSON', async () => {
    dir = await makeTree({ 'app/package.json': PKG });
    expect(await nodeWorkspaces(dir)).toBeNull();
    await removeTree(dir);
    dir = await makeTree({ 'package.json': '{ nope', 'app/package.json': PKG });
    expect(await nodeWorkspaces(dir)).toBeNull();
  });

  it('reads pnpm-workspace.yaml globs and negations', async () => {
    dir = await makeTree({
      'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n  - 'apps/*'\n  - '!packages/ignored'\n",
      'packages/api/package.json': PKG,
      'packages/ignored/package.json': PKG,
      'packages/no-manifest/README.md': 'x',
      'apps/web/package.json': PKG,
    });
    expect((await nodeWorkspaces(dir))?.sort()).toEqual(['apps/web', 'packages/api']);
  });

  it('reads package.json workspaces as an array or { packages }, with a BOM', async () => {
    dir = await makeTree({
      'package.json': `\uFEFF${root(['packages/*'])}`,
      'packages/a/package.json': PKG,
      'packages/b/package.json': PKG,
    });
    expect((await nodeWorkspaces(dir))?.sort()).toEqual(['packages/a', 'packages/b']);
    await removeTree(dir);
    dir = await makeTree({
      'package.json': root({ packages: ['packages/a'] }),
      'packages/a/package.json': PKG,
      'packages/b/package.json': PKG,
    });
    expect(await nodeWorkspaces(dir)).toEqual(['packages/a']);
  });

  it('never returns node_modules packages', async () => {
    dir = await makeTree({
      'package.json': root(['packages/**']),
      'packages/a/package.json': PKG,
      'packages/a/node_modules/dep/package.json': PKG,
    });
    expect(await nodeWorkspaces(dir)).toEqual(['packages/a']);
  });

  it('is an empty list (not null) when only negations are declared', async () => {
    dir = await makeTree({ 'package.json': root(['!packages/a']), 'packages/a/package.json': PKG });
    expect(await nodeWorkspaces(dir)).toEqual([]);
  });

  it('survives invalid YAML and warns with the file name only', async () => {
    dir = await makeTree({ 'pnpm-workspace.yaml': 'packages: [\n  - SECRET' });
    const onWarning = vi.fn();
    expect(await nodeWorkspaces(dir, { onWarning })).toBeNull();
    expect(onWarning).toHaveBeenCalledWith('pnpm-workspace.yaml', 'invalid-yaml');
    expect(JSON.stringify(onWarning.mock.calls)).not.toContain('SECRET');
  });

  it('ignores non-string patterns', async () => {
    dir = await makeTree({
      'package.json': root(['packages/*', 42, null]),
      'packages/a/package.json': PKG,
    });
    expect(await nodeWorkspaces(dir)).toEqual(['packages/a']);
  });

  it('ignores patterns that escape the project root', async () => {
    dir = await makeTree({
      'proj/pnpm-workspace.yaml':
        "packages:\n  - '../*'\n  - '/abs/*'\n  - 'C:/abs/*'\n  - 'packages/*'\n",
      'proj/packages/a/package.json': PKG,
      'sibling/package.json': PKG,
    });
    expect(await nodeWorkspaces(join(dir, 'proj'))).toEqual(['packages/a']);
  });
});
