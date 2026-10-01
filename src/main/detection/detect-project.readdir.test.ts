import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTree, removeTree } from './test-fixtures';

// A folder that exists but cannot be listed (permissions) is hard to make portably, so readdir fails on demand.
const failFor = new Set<string>();
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readdir: (async (path: string, ...rest: unknown[]) => {
      if (failFor.has(String(path))) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      return (actual.readdir as (...a: unknown[]) => unknown)(path, ...rest);
    }) as typeof actual.readdir,
  };
});

const { detectProject } = await import('./detect-project');

let dir = '';
afterEach(async () => {
  failFor.clear();
  await removeTree(dir);
});

describe('detectProject when a folder cannot be listed', () => {
  it('warns with the package path and keeps the other packages', async () => {
    dir = await makeTree({
      'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      'packages/api/package.json': '{"name":"api"}',
      'packages/web/package.json': '{"name":"web"}',
    });
    const { join } = await import('node:path');
    failFor.add(join(dir, 'packages', 'web'));
    const onWarning = vi.fn();
    const d = await detectProject({ id: 'r', path: dir }, { onWarning });
    expect(onWarning).toHaveBeenCalledWith('packages/web', 'unreadable');
    expect(d.workspaces.map((w) => [w.relPath, w.name])).toEqual([
      ['packages/api', 'api'],
      ['packages/web', 'web'],
    ]);
  });

  it('warns with "." for the root', async () => {
    dir = await makeTree({ 'package.json': '{"name":"x"}' });
    failFor.add(dir);
    const onWarning = vi.fn();
    await detectProject({ id: 'r', path: dir }, { onWarning });
    expect(onWarning).toHaveBeenCalledWith('.', 'unreadable');
  });
});
