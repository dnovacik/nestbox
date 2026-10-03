import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveInside } from './inside';

const ROOT = resolve('/project');

describe('resolveInside', () => {
  it('resolves a relative path inside the folder, with either separator', () => {
    expect(resolveInside(ROOT, 'src/a b.ts')).toBe(join(ROOT, 'src', 'a b.ts'));
    expect(resolveInside(ROOT, 'src\\index.ts')).toBe(join(ROOT, 'src', 'index.ts'));
  });

  it.each(['../outside.ts', 'src/../../x', '/etc/passwd', 'C:\\Windows\\x', '\\\\server\\share', 'a\\..\\..\\b', '', '.'])('rejects %j', (path) => {
    expect(() => resolveInside(ROOT, path)).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
  });
});
