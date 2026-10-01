import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTree, removeTree } from './test-fixtures';
import { findWorkspaceDirs } from './workspaces';

let dir = '';
afterEach(async () => removeTree(dir));

const PKG = '{"name":"x"}';

describe('findWorkspaceDirs', () => {
  it('returns [] when no workspaces are declared', async () => {
    dir = await makeTree({ 'package.json': PKG });
    expect(await findWorkspaceDirs(dir, {})).toEqual([]);
  });

  it('reads pnpm-workspace.yaml globs and negations', async () => {
    dir = await makeTree({
      'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n  - 'apps/*'\n  - '!packages/ignored'\n",
      'packages/api/package.json': PKG,
      'packages/ignored/package.json': PKG,
      'packages/no-manifest/README.md': 'x',
      'apps/web/package.json': PKG,
    });
    expect(await findWorkspaceDirs(dir, {})).toEqual(['apps/web', 'packages/api']);
  });

  it('reads package.json workspaces as an array or { packages }', async () => {
    dir = await makeTree({ 'packages/a/package.json': PKG, 'packages/b/package.json': PKG });
    expect(await findWorkspaceDirs(dir, { workspaces: ['packages/*'] })).toEqual(['packages/a', 'packages/b']);
    expect(await findWorkspaceDirs(dir, { workspaces: { packages: ['packages/a'] } })).toEqual(['packages/a']);
  });

  it('never returns node_modules packages, duplicates or the root', async () => {
    dir = await makeTree({
      'package.json': PKG,
      'packages/a/package.json': PKG,
      'packages/a/node_modules/dep/package.json': PKG,
      'node_modules/other/package.json': PKG,
    });
    const result = await findWorkspaceDirs(dir, { workspaces: ['packages/**', 'packages/*', './packages/a/', '.'] });
    expect(result).toEqual(['packages/a']);
  });

  it('survives invalid YAML and warns with the file name only', async () => {
    dir = await makeTree({ 'pnpm-workspace.yaml': 'packages: [\n  - SECRET' });
    const onWarning = vi.fn();
    expect(await findWorkspaceDirs(dir, null, { onWarning })).toEqual([]);
    expect(onWarning).toHaveBeenCalledWith('pnpm-workspace.yaml', 'invalid-yaml');
    expect(JSON.stringify(onWarning.mock.calls)).not.toContain('SECRET');
  });

  it('ignores non-string patterns', async () => {
    dir = await makeTree({ 'packages/a/package.json': PKG });
    expect(await findWorkspaceDirs(dir, { workspaces: ['packages/*', 42, null] })).toEqual(['packages/a']);
  });

  it('ignores patterns that escape the project root', async () => {
    dir = await makeTree({
      'proj/pnpm-workspace.yaml': "packages:\n  - '../*'\n  - '/abs/*'\n  - 'packages/*'\n",
      'proj/packages/a/package.json': PKG,
      'sibling/package.json': PKG,
    });
    expect(await findWorkspaceDirs(join(dir, 'proj'), {})).toEqual(['packages/a']);
  });
});
