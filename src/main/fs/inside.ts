import { isAbsolute, relative, resolve, win32 } from 'node:path';
import { NestboxError } from '@shared/errors';

/** A path or glob pattern that could leave the folder it is relative to: absolute (on either OS) or with `..`. */
export function escapesRoot(pattern: string): boolean {
  return (
    isAbsolute(pattern) ||
    pattern.startsWith('/') ||
    pattern.startsWith('\\') ||
    /^[a-zA-Z]:/.test(pattern) ||
    pattern.split(/[\\/]/).includes('..')
  );
}

/**
 * A relative path from the renderer (as git or a scan printed it), resolved inside root. VALIDATION for an
 * absolute path on either OS, any `..` segment, or anything that lands on root itself or outside it.
 */
export function resolveInside(root: string, path: string): string {
  const segments = path.split(/[\\/]/);
  if (isAbsolute(path) || win32.isAbsolute(path) || segments.includes('..')) {
    throw new NestboxError('VALIDATION', 'The path must be inside the project');
  }
  const abs = resolve(root, ...segments);
  const rel = relative(root, abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new NestboxError('VALIDATION', 'The path must be inside the project');
  }
  return abs;
}
