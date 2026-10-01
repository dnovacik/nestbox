import { isRecord } from '@shared/is-record';

/** The `code` of a Node system error (EPERM, ENOENT…), or 'unknown'. Safe to log. */
export function errorCode(error: unknown): string {
  const code = isRecord(error) ? error.code : undefined;
  return typeof code === 'string' ? code : 'unknown';
}
