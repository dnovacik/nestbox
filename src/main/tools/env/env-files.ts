import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { APPSETTINGS_FILE } from '@shared/tools/env/contract';
import { ENV_FILE_PATTERN } from '../../detection/detect-project';
import { createVersionedFiles, type VersionedFiles } from '../../fs/versioned-file';

/** Env files are small; anything bigger is not one we should be editing. */
export const MAX_ENV_FILE_BYTES = 1024 * 1024;
/** appsettings files: the same 1 MiB cap. */
export const MAX_CONFIG_FILE_BYTES = 1024 * 1024;

export interface EnvFileAccess {
  /** The env files in dir right now, sorted (detection results can be stale). Symlinks are read-only. */
  list(dir: string): Promise<{ name: string; readOnly: boolean }[]>;
  read: VersionedFiles['read'];
  write: VersionedFiles['write'];
}

/** appsettings*.json in a package folder: same shape as the env files. */
export type ConfigFileAccess = EnvFileAccess;

/** Files in dir whose names match, sorted; symlinks to files are listed read-only. */
async function listMatching(
  dir: string,
  pattern: RegExp,
): Promise<{ name: string; readOnly: boolean }[]> {
  const dirents = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: { name: string; readOnly: boolean }[] = [];
  for (const d of dirents) {
    if (!pattern.test(d.name)) continue;
    if (d.isFile()) out.push({ name: d.name, readOnly: false });
    else if (d.isSymbolicLink() && (await stat(join(dir, d.name)).catch(() => null))?.isFile()) {
      out.push({ name: d.name, readOnly: true });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function createEnvFileAccess(): EnvFileAccess {
  const versioned = createVersionedFiles({
    allowName: (name) => ENV_FILE_PATTERN.test(name),
    maxBytes: MAX_ENV_FILE_BYTES,
    noun: 'env file',
  });
  return {
    list: (dir) => listMatching(dir, ENV_FILE_PATTERN),
    read: versioned.read,
    write: versioned.write,
  };
}

export function createConfigFileAccess(): ConfigFileAccess {
  const versioned = createVersionedFiles({
    allowName: (name) => APPSETTINGS_FILE.test(name),
    maxBytes: MAX_CONFIG_FILE_BYTES,
    noun: 'settings file',
  });
  return {
    list: (dir) => listMatching(dir, APPSETTINGS_FILE),
    read: versioned.read,
    write: versioned.write,
  };
}
