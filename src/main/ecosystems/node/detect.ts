// Node.js detection of one folder: a package.json, and the package manager from the lockfile's name, else
// package.json's packageManager field (read only then: a lockfile needs no file read).
import { z } from 'zod';
import { PACKAGE_MANAGERS } from '@shared/detected';
import type { DetectContext } from '../types';
import { readPackageJson } from './package-json';
import { choosePackageManager, lockfilesIn, PACKAGE_MANAGER_SOURCES } from './package-manager';

/**
 * Node.js project info: which package manager runs this package.
 */
export const NodeInfoSchema = z.object({
  /** From the lockfile, else package.json's packageManager field, else npm. */
  packageManager: z.enum(PACKAGE_MANAGERS),
  packageManagerSource: z.enum(PACKAGE_MANAGER_SOURCES),
  /** The lockfile names in the folder that decided (the root's for a workspace package when it has any). */
  lockfiles: z.array(z.string()),
});
export type NodeInfo = z.infer<typeof NodeInfoSchema>;

/** The manager a lockfile names; null when it came from the packageManager field or npm's default. */
export function lockfileManager(info: NodeInfo): NodeInfo['packageManager'] | null {
  return info.packageManagerSource === 'lockfile' ? info.packageManager : null;
}

/**
 * Detect Node.js projects by looking for package.json, and pick the package manager (choosePackageManager):
 * the lockfile's name, else the packageManager field, else npm. The same rule as the project's packageManager,
 * so tasks and scripts agree: a workspace package takes the root's lockfile, then the root's field, first.
 */
export async function detectNode(
  dir: string,
  files: ReadonlySet<string>,
  _dirs: ReadonlySet<string>,
  ctx?: DetectContext,
): Promise<NodeInfo | null> {
  if (!files.has('package.json')) return null;
  const root = ctx?.root ?? null;
  const fromLockfile = choosePackageManager({ files, root: root && { files: root.files } });
  const fieldOf = async (folder: string) => (await readPackageJson(folder))?.['packageManager'];
  const { manager, source } =
    fromLockfile.source === 'lockfile'
      ? fromLockfile
      : choosePackageManager({
          files,
          field: await fieldOf(dir),
          root: root && {
            files: root.files,
            field: root.files.has('package.json') ? await fieldOf(root.path) : undefined,
          },
        });
  const rootLockfiles = root ? lockfilesIn(root.files) : [];
  return {
    packageManager: manager,
    packageManagerSource: source,
    lockfiles: rootLockfiles.length > 0 ? rootLockfiles : lockfilesIn(files),
  };
}
