// Node.js detection of one folder: a package.json (read once, capped: the packageManager field
// and dependency names), the manager from the lockfile's name, else that field, and the framework.
import { z } from 'zod';
import { PACKAGE_MANAGERS } from '@shared/detected';
import type { DetectContext } from '../types';
import { detectFramework, FrameworkSchema } from './framework';
import { readPackageJson } from './package-json';
import { choosePackageManager, lockfilesIn, PACKAGE_MANAGER_SOURCES } from './package-manager';

/**
 * Node.js project info: which package manager runs this package, and what it is built with.
 */
export const NodeInfoSchema = z.object({
  /** From the lockfile, else package.json's packageManager field, else npm. */
  packageManager: z.enum(PACKAGE_MANAGERS),
  packageManagerSource: z.enum(PACKAGE_MANAGER_SOURCES),
  /** The lockfile names in the folder that decided (the root's for a workspace package when it has any). */
  lockfiles: z.array(z.string()),
  /** From dependency names (Next.js before Vite, …); null when none is known. */
  framework: FrameworkSchema.nullable(),
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
  const json = await readPackageJson(dir);
  const fromLockfile = choosePackageManager({ files, root: root && { files: root.files } });
  const { manager, source } =
    fromLockfile.source === 'lockfile'
      ? fromLockfile
      : choosePackageManager({
          files,
          field: json?.['packageManager'],
          root: root && {
            files: root.files,
            field: root.files.has('package.json')
              ? (await readPackageJson(root.path))?.['packageManager']
              : undefined,
          },
        });
  const rootLockfiles = root ? lockfilesIn(root.files) : [];
  return {
    packageManager: manager,
    packageManagerSource: source,
    lockfiles: rootLockfiles.length > 0 ? rootLockfiles : lockfilesIn(files),
    framework: detectFramework(json),
  };
}
