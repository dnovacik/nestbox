import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTree, removeTree } from '../../detection/test-fixtures';
import { scanFiles } from './scan';

const TAGS = ['TODO', 'FIXME'];
let dir = '';
afterEach(async () => removeTree(dir));

describe('scanFiles', () => {
  it('finds tagged comments with their line numbers, sorted by path then line', async () => {
    dir = await makeTree({
      'src/b.ts': 'const a = 1;\n// TODO: second file\n',
      'src/a.ts': '// FIXME: first\r\nconst x = 1;\r\n# TODO(dan): third line\r\n',
      'README.md': 'no tags here\n',
    });
    const out = await scanFiles(dir, ['src/b.ts', 'src/a.ts', 'README.md'], TAGS);
    expect(out.todos).toEqual([
      { path: 'src/a.ts', line: 1, tag: 'FIXME', text: 'first', owner: null },
      { path: 'src/a.ts', line: 3, tag: 'TODO', text: 'third line', owner: 'dan' },
      { path: 'src/b.ts', line: 2, tag: 'TODO', text: 'second file', owner: null },
    ]);
    expect(out).toMatchObject({ files: 3, truncated: null });
  });

  it('skips binary, minified, oversized and missing files', async () => {
    dir = await makeTree({ 'logo.png': '// TODO: not text', 'app.min.js': '// TODO: minified', 'src/ok.ts': '// TODO: kept' });
    await writeFile(join(dir, 'blob.dat'), Buffer.concat([Buffer.from('// TODO: binary\n'), Buffer.from([0, 1, 2])]));
    await writeFile(join(dir, 'huge.ts'), `// TODO: big\n${'x'.repeat(1024 * 1024 + 10)}`);
    const out = await scanFiles(dir, ['logo.png', 'app.min.js', 'blob.dat', 'huge.ts', 'gone.ts', 'src/ok.ts'], TAGS);
    expect(out.todos.map((t) => t.path)).toEqual(['src/ok.ts']);
    expect(out.files).toBe(1);
  });

  it('stops at the match limit and says so', async () => {
    dir = await makeTree({ 'a.ts': '// TODO: 1\n// TODO: 2\n// TODO: 3\n' });
    const out = await scanFiles(dir, ['a.ts'], TAGS, { maxMatches: 2 });
    expect(out.todos).toHaveLength(2);
    expect(out.truncated).toBe('matches');
  });

  it('stops at the time limit and says so', async () => {
    dir = await makeTree({ 'a.ts': '// TODO: 1\n', 'b.ts': '// TODO: 2\n' });
    let t = 0;
    const out = await scanFiles(dir, ['a.ts', 'b.ts'], TAGS, { timeLimitMs: 5, now: () => (t += 10), concurrency: 1 });
    expect(out.truncated).toBe('time');
    expect(out.todos.length).toBeLessThan(2);
  });

  it('never follows a symlink, which could point outside the project', async () => {
    dir = await makeTree({ 'a.ts': '// TODO: in' });
    const outside = await mkdtemp(join(tmpdir(), 'nestbox-outside-'));
    try {
      await writeFile(join(outside, 'secret.txt'), '# TODO: private note outside the project\n');
      // Windows needs a privilege for symlinks: nothing to check there without one.
      const linked = await symlink(join(outside, 'secret.txt'), join(dir, 'link.txt')).then(() => true, () => false);
      if (!linked) return;
      const out = await scanFiles(dir, ['a.ts', 'link.txt'], TAGS);
      expect(out.todos.map((t) => t.path)).toEqual(['a.ts']);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('never follows a symlinked folder out of the project', async () => {
    dir = await makeTree({ 'a.ts': '// TODO: in' });
    const outside = await mkdtemp(join(tmpdir(), 'nestbox-outside-'));
    try {
      await writeFile(join(outside, 'x.ts'), '// TODO: outside through a folder link\n');
      const linked = await symlink(outside, join(dir, 'linked'), 'junction').then(() => true, () => false);
      if (!linked) return;
      const out = await scanFiles(dir, ['a.ts', 'linked/x.ts'], TAGS);
      expect(out.todos.map((t) => t.path)).toEqual(['a.ts']);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('never reads outside the folder', async () => {
    dir = await makeTree({ 'a.ts': '// TODO: in' });
    const out = await scanFiles(dir, ['../outside.ts', '/etc/passwd', 'a.ts'], TAGS);
    expect(out.todos.map((t) => t.path)).toEqual(['a.ts']);
  });
});
