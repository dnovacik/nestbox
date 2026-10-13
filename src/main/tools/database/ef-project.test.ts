import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findDbContexts, findEfTool } from './ef-project';

let root = '';
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nestbox-ef-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function files(entries: Record<string, string>) {
  for (const [rel, text] of Object.entries(entries)) {
    await mkdir(join(root, ...rel.split('/').slice(0, -1)), { recursive: true });
    await writeFile(join(root, ...rel.split('/')), text);
  }
}

const manifest = (tools: Record<string, object>, isRoot = false) =>
  JSON.stringify({ version: 1, isRoot, tools });
const none = () => ({ commandExists: async () => false, home: join(root, 'home') });

describe('findEfTool', () => {
  it('finds a local tool in .config or the folder, here or in a parent', async () => {
    await files({
      'a/.config/dotnet-tools.json': manifest({ 'dotnet-ef': {} }),
      'b/dotnet-tools.json': manifest({ 'dotnet-ef': {} }),
      'c/dotnet-tools.json': manifest({ 'dotnet-ef': {} }),
      'c/d/x.txt': '',
    });
    expect(await findEfTool(join(root, 'a'), none())).toBe('local');
    expect(await findEfTool(join(root, 'b'), none())).toBe('local');
    expect(await findEfTool(join(root, 'c', 'd'), none())).toBe('local');
  });

  it('stops at an isRoot manifest without dotnet-ef, then falls back to a global tool', async () => {
    await files({
      'dotnet-tools.json': manifest({ 'dotnet-ef': {} }),
      'p/dotnet-tools.json': manifest({ other: {} }, true),
    });
    expect(await findEfTool(join(root, 'p'), none())).toBeNull();
    expect(
      await findEfTool(join(root, 'p'), {
        ...none(),
        commandExists: async (c: string) => c === 'dotnet-ef',
      }),
    ).toBe('global');
    await files({ 'home/.dotnet/tools/dotnet-ef.exe': '' });
    expect(await findEfTool(join(root, 'p'), none())).toBe('global');
  });

  it('treats an unreadable manifest as absent', async () => {
    await files({ 'p/dotnet-tools.json': '{ nope', 'p/.config/dotnet-tools.json': '[]' });
    expect(await findEfTool(join(root, 'p'), none())).toBeNull();
  });
});

describe('findDbContexts', () => {
  it('finds classes deriving from a DbContext, skipping abstract and generic ones, comments, bin and obj', async () => {
    await files({
      'Data/Shop.cs':
        'public class ShopDbContext(DbContextOptions<ShopDbContext> o) : DbContext(o) { }',
      'Data/Auth.cs':
        'namespace A { internal sealed partial class AuthContext : IdentityDbContext<User> { } }',
      'Data/Qualified.cs': 'public class Billing : My.Data.AppDbContext { }',
      'Data/Base.cs': 'public abstract class AppDbContext : DbContext { }',
      'Data/Commented.cs': '// public class Old : DbContext {}\n/* class Older : DbContext {} */',
      'Data/Other.cs': 'public class Repo : IRepository { }',
      'Data/Generic.cs': 'public class Store<T> : DbContext where T : class { }',
      'bin/Debug/Gen.cs': 'class Gen : DbContext {}',
      'obj/Gen2.cs': 'class Gen2 : DbContext {}',
      '.hidden/Gen3.cs': 'class Gen3 : DbContext {}',
      'Data/Dup.cs': 'partial class ShopDbContext : DbContext {}',
    });
    expect(await findDbContexts(root)).toEqual(['AuthContext', 'Billing', 'ShopDbContext']);
  });

  it('keeps at most 20', async () => {
    await files(
      Object.fromEntries(
        Array.from({ length: 25 }, (_, i) => [
          `C${i}.cs`,
          `class C${String(i).padStart(2, '0')} : DbContext {}`,
        ]),
      ),
    );
    expect(await findDbContexts(root)).toHaveLength(20);
  });

  it('is empty for a missing folder', async () => {
    expect(await findDbContexts(join(root, 'missing'))).toEqual([]);
  });
});
