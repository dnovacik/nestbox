import { lstat, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NestboxError } from '@shared/errors';
import { ENV_FILE_PATTERN } from '../../detection/detect-project';

/** Env files are small; anything bigger is not one we should be editing. */
export const MAX_ENV_FILE_BYTES = 1024 * 1024;

export interface EnvFileAccess {
  /** Text (UTF-8) and a version token (mtime and size). NOT_FOUND when the file does not exist. */
  read(dir: string, name: string): Promise<{ text: string; version: string }>;
  /**
   * Writes atomically (temp file and rename). expectedVersion: the version the edit was based on (CONFLICT
   * when the file changed since), null to create a file that must not exist yet, or 'any' to overwrite.
   */
  write(dir: string, name: string, text: string, expectedVersion: string | null): Promise<{ version: string }>;
}

function assertName(name: string): void {
  if (!ENV_FILE_PATTERN.test(name) || /[\\/\0]/.test(name) || name.includes('..')) {
    throw new NestboxError('VALIDATION', 'Not an env file name');
  }
}

const versionOf = (s: { mtimeMs: number; size: number }) => `${Math.round(s.mtimeMs)}:${s.size}`;

/** lstat, or null when the file does not exist. */
async function lstatOrNull(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new NestboxError('INTERNAL', 'Could not read the env file');
  }
}

export function createEnvFileAccess(): EnvFileAccess {
  return {
    async read(dir, name) {
      assertName(name);
      const path = join(dir, name);
      // stat (not lstat): a symlinked env file can be read, only not written.
      const info = await stat(path).catch(() => null);
      if (!info?.isFile()) throw new NestboxError('NOT_FOUND', 'The env file does not exist');
      if (info.size > MAX_ENV_FILE_BYTES) throw new NestboxError('VALIDATION', 'The env file is too large');
      const text = await readFile(path, 'utf8').catch(() => {
        throw new NestboxError('INTERNAL', 'Could not read the env file');
      });
      return { text, version: versionOf(info) };
    },

    async write(dir, name, text, expectedVersion) {
      assertName(name);
      if (Buffer.byteLength(text, 'utf8') > MAX_ENV_FILE_BYTES) {
        throw new NestboxError('VALIDATION', 'The env file would be too large');
      }
      const path = join(dir, name);
      const current = await lstatOrNull(path);
      if (current?.isSymbolicLink()) throw new NestboxError('FORBIDDEN', 'Symlinked env files are read-only');
      if (current && !current.isFile()) throw new NestboxError('VALIDATION', 'Not an env file');
      if (expectedVersion === null && current) throw new NestboxError('CONFLICT', 'The env file already exists');
      if (expectedVersion !== null && expectedVersion !== 'any' && (!current || versionOf(current) !== expectedVersion)) {
        throw new NestboxError('CONFLICT', 'The file changed on disk. Reload and try again.');
      }
      const temp = join(dir, `.nestbox-${randomUUID()}.tmp`);
      try {
        await writeFile(temp, text, 'utf8');
        await rename(temp, path);
      } catch {
        await rm(temp, { force: true }).catch(() => undefined);
        throw new NestboxError('INTERNAL', 'Could not write the env file');
      }
      return { version: versionOf(await stat(path)) };
    },
  };
}
