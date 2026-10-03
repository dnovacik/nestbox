import { posix, win32 } from 'node:path';

export function normalizeWin32Path(p: string): string {
  const resolved = win32.resolve(p);
  const trimmed = /^[a-zA-Z]:\\$/.test(resolved) ? resolved : resolved.replace(/[\\/]+$/, '');
  return trimmed.toLowerCase();
}

export function normalizePosixPath(p: string): string {
  const resolved = posix.resolve(p);
  return resolved === '/' ? resolved : resolved.replace(/\/+$/, '');
}

/** Comparison key on macOS: APFS is case-insensitive by default and Finder may hand over decomposed accents. */
export function normalizeDarwinPath(p: string): string {
  return normalizePosixPath(p).normalize('NFC').toLowerCase();
}
