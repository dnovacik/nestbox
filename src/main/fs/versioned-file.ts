// Reads and writes small project text files with a version token, so an edit based on an old read is
// refused (CONFLICT) instead of overwriting someone else's change. Used by the env and Claude tools,
// each with its own allowed names. Messages name the kind of file, never its contents.
import { lstat, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NestboxError } from '@shared/errors';

export interface VersionedFileOptions {
  /** Whether name is a file this kind may touch (a plain file name; path separators are always refused). */
  allowName(name: string): boolean;
  maxBytes: number;
  /** For messages: 'env file', 'document'. */
  noun: string;
}

export interface VersionedFiles {
  /** Text (UTF-8) and a version token. NOT_FOUND when the file does not exist. Symlinks are followed. */
  read(dir: string, name: string): Promise<{ text: string; version: string }>;
  /**
   * Writes atomically (temp file and rename). expectedVersion: the version the edit was based on (CONFLICT
   * when the file changed since), null to create a file that must not exist yet, or 'any' to overwrite.
   * Symlinks are read-only (FORBIDDEN).
   */
  write(
    dir: string,
    name: string,
    text: string,
    expectedVersion: string | null,
  ): Promise<{ version: string }>;
}

/**
 * Changes whenever the file does: atomic writes give it a new inode, and other writers change the
 * nanosecond mtime or the size. Never derived from the contents.
 */
const versionOf = (s: { ino: bigint; mtimeNs: bigint; size: bigint }) =>
  `${s.ino}:${s.mtimeNs}:${s.size}`;

/** Windows refuses a rename while another handle (an antivirus scan, an editor, an indexer) has the file open. */
const BUSY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
/** 20 ms doubling: about 1.3 s in all before the error is reported. */
const RENAME_DELAYS_MS = [20, 40, 80, 160, 320, 640];

/** rename, retried briefly while the target or the temp file is held open. Other errors fail at once. */
export async function renameWithRetry(
  from: string,
  to: string,
  io: { rename: (from: string, to: string) => Promise<void>; sleep: (ms: number) => Promise<void> } = {
    rename,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  },
): Promise<void> {
  for (const delay of RENAME_DELAYS_MS) {
    try {
      return await io.rename(from, to);
    } catch (error) {
      if (!BUSY_CODES.has(String((error as NodeJS.ErrnoException).code))) throw error;
      await io.sleep(delay);
    }
  }
  return io.rename(from, to);
}

export function createVersionedFiles({
  allowName,
  maxBytes,
  noun,
}: VersionedFileOptions): VersionedFiles {
  function assertName(name: string): void {
    if (!allowName(name) || /[\\/\0]/.test(name) || name.includes('..')) {
      throw new NestboxError('VALIDATION', `Not a ${noun} name`);
    }
  }

  /** lstat, or null when the file does not exist. */
  async function lstatOrNull(path: string) {
    try {
      return await lstat(path, { bigint: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new NestboxError('INTERNAL', `Could not read the ${noun}`);
    }
  }

  return {
    async read(dir, name) {
      assertName(name);
      const path = join(dir, name);
      // stat (not lstat): a symlinked file can be read, only not written.
      const info = await stat(path, { bigint: true }).catch(() => null);
      if (!info?.isFile()) throw new NestboxError('NOT_FOUND', `The ${noun} does not exist`);
      if (info.size > BigInt(maxBytes))
        throw new NestboxError('VALIDATION', `The ${noun} is too large`);
      const text = await readFile(path, 'utf8').catch(() => {
        throw new NestboxError('INTERNAL', `Could not read the ${noun}`);
      });
      return { text, version: versionOf(info) };
    },

    async write(dir, name, text, expectedVersion) {
      assertName(name);
      if (Buffer.byteLength(text, 'utf8') > maxBytes) {
        throw new NestboxError('VALIDATION', `The ${noun} would be too large`);
      }
      const path = join(dir, name);
      const current = await lstatOrNull(path);
      if (current?.isSymbolicLink())
        throw new NestboxError('FORBIDDEN', `A symlinked ${noun} is read-only`);
      if (current && !current.isFile()) throw new NestboxError('VALIDATION', `Not a ${noun}`);
      if (expectedVersion === null && current)
        throw new NestboxError('CONFLICT', `The ${noun} already exists`);
      if (
        expectedVersion !== null &&
        expectedVersion !== 'any' &&
        (!current || versionOf(current) !== expectedVersion)
      ) {
        throw new NestboxError('CONFLICT', 'The file changed on disk. Reload and try again.');
      }
      const temp = join(dir, `.nestbox-${randomUUID()}.tmp`);
      try {
        await writeFile(temp, text, 'utf8');
        await renameWithRetry(temp, path);
      } catch {
        await rm(temp, { force: true }).catch(() => undefined);
        throw new NestboxError('INTERNAL', `Could not write the ${noun}`);
      }
      return { version: versionOf(await stat(path, { bigint: true })) };
    },
  };
}
