import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTree, removeTree } from '../../detection/test-fixtures';
import { listFiles, parseLsFiles, walkFiles } from './files';

let dir = '';
afterEach(async () => removeTree(dir));

describe('parseLsFiles', () => {
  it('splits NUL-separated paths', () => {
    expect(parseLsFiles('src/a.ts\0b c.md\0', false)).toEqual(['src/a.ts', 'b c.md']);
  });

  it('drops the cut path of truncated output', () => {
    expect(parseLsFiles('src/a.ts\0src/b', true)).toEqual(['src/a.ts']);
  });
});

describe('walkFiles', () => {
  it('skips dependency and build folders and applies the root .gitignore', async () => {
    dir = await makeTree({
      'src/a.ts': '',
      'src/deep/b.ts': '',
      '.github/workflows/ci.yml': '',
      'node_modules/x/index.js': '',
      'packages/web/node_modules/y/index.js': '',
      'dist/out.js': '',
      'coverage/lcov.info': '',
      '.git/HEAD': '',
      'secret.log': '',
      'logs/today.txt': '',
      '.gitignore': '*.log\nlogs/\n',
    });
    const { files, truncated } = await walkFiles(dir, { maxFiles: 100 });
    expect(files.sort()).toEqual(['.github/workflows/ci.yml', '.gitignore', 'src/a.ts', 'src/deep/b.ts']);
    expect(truncated).toBe(false);
  });

  it('stops at the file limit', async () => {
    dir = await makeTree({ 'a.ts': '', 'b.ts': '', 'c.ts': '' });
    expect(await walkFiles(dir, { maxFiles: 2 })).toMatchObject({ truncated: true, files: expect.arrayContaining([]) });
    expect((await walkFiles(dir, { maxFiles: 2 })).files).toHaveLength(2);
  });
});

describe('listFiles', () => {
  it('uses git ls-files when the folder is in a repository', async () => {
    const exec = vi.fn(async () => ({ code: 0, stdout: 'src/a.ts\0README.md\0' }));
    expect(await listFiles('/p', { exec, maxFiles: 100 })).toEqual({ source: 'git', files: ['src/a.ts', 'README.md'], truncated: false });
    expect(exec).toHaveBeenCalledWith(['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  });

  it('keeps the file limit with git too', async () => {
    const exec = vi.fn(async () => ({ code: 0, stdout: 'a\0b\0c\0' }));
    expect(await listFiles('/p', { exec, maxFiles: 2 })).toEqual({ source: 'git', files: ['a', 'b'], truncated: true });
  });

  it('walks the folder when git says it is not a repository, or git is missing', async () => {
    dir = await makeTree({ 'src/a.ts': '' });
    expect(await listFiles(dir, { exec: async () => ({ code: 128, stdout: '' }), maxFiles: 100 })).toEqual({ source: 'walk', files: ['src/a.ts'], truncated: false });
    expect(await listFiles(dir, { exec: async () => Promise.reject(new Error('ENOENT')), maxFiles: 100 })).toMatchObject({ source: 'walk' });
  });
});
