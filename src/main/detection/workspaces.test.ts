import { symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTree, removeTree } from './test-fixtures';
import { findWorkspaceDirs } from './workspaces';

let dir = '';
afterEach(async () => removeTree(dir));

const PKG = '{"name":"x"}';

describe('findWorkspaceDirs', () => {
  it('returns [] when no workspaces are declared and no sub-folder has a package.json', async () => {
    dir = await makeTree({ 'package.json': PKG, 'src/index.ts': '' });
    expect(await findWorkspaceDirs(dir, {})).toEqual([]);
  });

  it('finds sub-folder packages up to two levels down when no workspaces are declared', async () => {
    dir = await makeTree({
      'app/package.json': PKG,
      'api/package.json': PKG,
      'services/billing/package.json': PKG,
      'too/deep/here/package.json': PKG,
      'app/node_modules/dep/package.json': PKG,
      '.cache/x/package.json': PKG,
      'dist/package.json': PKG,
      'test/fixtures/package.json': PKG,
      'e2e/package.json': PKG,
    });
    expect(await findWorkspaceDirs(dir, null)).toEqual(['api', 'app', 'services/billing']);
  });

  it('does not add sub-folders when workspaces are declared', async () => {
    dir = await makeTree({ 'packages/a/package.json': PKG, 'tools/b/package.json': PKG });
    expect(await findWorkspaceDirs(dir, { workspaces: ['packages/*'] })).toEqual(['packages/a']);
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
    expect(await findWorkspaceDirs(dir, { workspaces: ['packages/*'] })).toEqual([
      'packages/a',
      'packages/b',
    ]);
    expect(await findWorkspaceDirs(dir, { workspaces: { packages: ['packages/a'] } })).toEqual([
      'packages/a',
    ]);
  });

  it('never returns node_modules packages, duplicates or the root', async () => {
    dir = await makeTree({
      'package.json': PKG,
      'packages/a/package.json': PKG,
      'packages/a/node_modules/dep/package.json': PKG,
      'node_modules/other/package.json': PKG,
    });
    const result = await findWorkspaceDirs(dir, {
      workspaces: ['packages/**', 'packages/*', './packages/a/', '.'],
    });
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
    expect(await findWorkspaceDirs(dir, { workspaces: ['packages/*', 42, null] })).toEqual([
      'packages/a',
    ]);
  });

  it('ignores patterns that escape the project root', async () => {
    dir = await makeTree({
      'proj/pnpm-workspace.yaml': "packages:\n  - '../*'\n  - '/abs/*'\n  - 'packages/*'\n",
      'proj/packages/a/package.json': PKG,
      'sibling/package.json': PKG,
    });
    expect(await findWorkspaceDirs(join(dir, 'proj'), {})).toEqual(['packages/a']);
  });

  it('skips a symlinked package that resolves outside the root, with a warning', async (ctx) => {
    const outside = await makeTree({ 'package.json': PKG });
    try {
      dir = await makeTree({
        'package.json': PKG,
        'packages/api/package.json': PKG,
        packages: null,
      });
      try {
        // 'junction' makes a directory link without a privilege on Windows; it is ignored elsewhere.
        await symlink(outside, join(dir, 'packages', 'linked'), 'junction');
      } catch {
        ctx.skip();
      }
      const onWarning = vi.fn();
      expect(await findWorkspaceDirs(dir, { workspaces: ['packages/*'] }, { onWarning })).toEqual([
        'packages/api',
      ]);
      expect(onWarning).toHaveBeenCalledWith('packages/linked', 'outside-root');
    } finally {
      await removeTree(outside);
    }
  });

  it('keeps a symlinked package that resolves inside the root', async (ctx) => {
    dir = await makeTree({ 'package.json': PKG, 'libs/real/package.json': PKG, packages: null });
    try {
      await symlink(join(dir, 'libs', 'real'), join(dir, 'packages', 'alias'), 'junction');
    } catch {
      ctx.skip();
    }
    expect(await findWorkspaceDirs(dir, { workspaces: ['packages/*'] })).toEqual([
      'packages/alias',
    ]);
  });
});

describe('findWorkspaceDirs with .NET projects', () => {
  const CSPROJ = '<Project Sdk="Microsoft.NET.Sdk"></Project>';
  const slnProject = (name: string, path: string) =>
    `Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "${name}", "${path}", "{12345678-1234-1234-1234-123456789ABC}"\r\nEndProject\r\n`;

  it('finds project folders without a package.json, skipping build output and test folders', async () => {
    dir = await makeTree({
      'api/Api.csproj': CSPROJ,
      'src/Worker/Worker.fsproj': CSPROJ,
      'web/package.json': PKG,
      'api/bin/Debug/Copy.csproj': CSPROJ,
      'Api.Tests/Api.Tests.csproj': CSPROJ,
      'src/Api.IntegrationTests/Api.IntegrationTests.csproj': CSPROJ,
      'tests/Unit/Unit.csproj': CSPROJ,
      'too/deep/here/Deep.csproj': CSPROJ,
    });
    expect(await findWorkspaceDirs(dir, null)).toEqual(['api', 'src/Worker', 'web']);
  });

  it("adds a root solution's projects at any depth, next to Node sub-folders", async () => {
    dir = await makeTree({
      'Shop.sln':
        'Microsoft Visual Studio Solution File, Format Version 12.00\r\n' +
        slnProject('Api', 'src\\Services\\Api\\Api.csproj') +
        slnProject('Tests', 'tests\\Shop.Tests\\Shop.Tests.csproj') +
        slnProject('Elsewhere', '..\\Other\\Other.csproj') +
        slnProject('Gone', 'src\\Gone\\Gone.csproj'),
      'src/Services/Api/Api.csproj': CSPROJ,
      'tests/Shop.Tests/Shop.Tests.csproj': CSPROJ,
      'web/package.json': PKG,
    });
    expect(await findWorkspaceDirs(dir, null)).toEqual(['src/Services/Api', 'web']);
  });

  it('reads .slnx solutions (with a BOM)', async () => {
    dir = await makeTree({
      'Shop.slnx':
        '\uFEFF<Solution>\n  <Folder Name="/src/">\n    <Project Path="src/Deep/Shop.Api/Shop.Api.csproj" />\n  </Folder>\n' +
        '  <Folder Name="/tests/">\n    <Project Path="tests/Shop.Tests/Shop.Tests.csproj" />\n  </Folder>\n</Solution>\n',
      'src/Deep/Shop.Api/Shop.Api.csproj': CSPROJ,
      'tests/Shop.Tests/Shop.Tests.csproj': CSPROJ,
    });
    expect(await findWorkspaceDirs(dir, null)).toEqual(['src/Deep/Shop.Api']);
  });

  it('adds solution projects to declared workspaces', async () => {
    dir = await makeTree({
      'Shop.sln': slnProject('Api', 'backend/Core/Api/Api.csproj'),
      'backend/Core/Api/Api.csproj': CSPROJ,
      'packages/a/package.json': PKG,
    });
    expect(await findWorkspaceDirs(dir, { workspaces: ['packages/*'] })).toEqual([
      'backend/Core/Api',
      'packages/a',
    ]);
  });

  it('ignores a solution file over the size cap', async () => {
    dir = await makeTree({
      'Big.sln': slnProject('Api', 'x/y/Api/Api.csproj') + ' '.repeat(1024 * 1024 + 1),
      'x/y/Api/Api.csproj': CSPROJ,
    });
    expect(await findWorkspaceDirs(dir, null)).toEqual([]);
  });
});
