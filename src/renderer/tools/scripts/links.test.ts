import { describe, expect, it } from 'vitest';
import { findLinks } from './links';

function only(text: string) {
  const links = findLinks(text);
  expect(links).toHaveLength(1);
  const [link] = links;
  if (!link) throw new Error('no link');
  return { path: link.path, line: link.line, visible: text.slice(link.start, link.end) };
}

describe('findLinks', () => {
  it('finds Node stack frames with spaces inside parentheses', () => {
    expect(only('    at main (C:\\Users\\me\\My App\\src\\index.ts:12:5)')).toEqual({
      path: 'C:\\Users\\me\\My App\\src\\index.ts',
      line: 12,
      visible: 'C:\\Users\\me\\My App\\src\\index.ts:12:5',
    });
  });

  it('finds bare absolute Windows paths', () => {
    expect(only('    at C:\\dev\\app\\dist\\main.js:3:9')).toMatchObject({ path: 'C:\\dev\\app\\dist\\main.js', line: 3 });
  });

  it('finds tsc diagnostics', () => {
    expect(only('src/app.ts(12,5): error TS2322: Type x')).toMatchObject({
      path: 'src/app.ts',
      line: 12,
      visible: 'src/app.ts(12,5)',
    });
  });

  it('finds Vite rooted paths and relative paths', () => {
    expect(only('[vite] /src/App.tsx:3:1 failed')).toMatchObject({ path: '/src/App.tsx', line: 3 });
    expect(only('see ./lib/x.mjs:7')).toMatchObject({ path: './lib/x.mjs', line: 7, visible: './lib/x.mjs:7' });
  });

  it('finds file URLs', () => {
    expect(only('file:///C:/dev/app/index.js:1:1')).toMatchObject({ path: 'file:///C:/dev/app/index.js', line: 1 });
  });

  it.each(['http://localhost:3000', '12:03:04', 'v1.2.3:4', 'ratio 3:2', 'node:internal/modules/cjs/loader:1228', 'a.ts:0'])(
    'ignores %s',
    (text) => {
      expect(findLinks(text)).toEqual([]);
    },
  );

  it('returns several links in order', () => {
    expect(findLinks('src/a.ts:1 and src/b.ts:2').map((l) => l.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });
});
