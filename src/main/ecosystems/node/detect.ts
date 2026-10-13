// Node.js detection of one folder: a package.json, and the package manager from the lockfile's name.
// Pure: no file is read.
import { z } from 'zod';
import { PACKAGE_MANAGERS } from '@shared/detected';
import type { DetectContext } from '../types';
import { detectPackageManager } from './package-manager';

/**
 * Node.js project info: which package manager runs this package.
 */
export const NodeInfoSchema = z.object({
  /** Package manager detected from the lockfile (npm without one). */
  packageManager: z.enum(PACKAGE_MANAGERS),
});
export type NodeInfo = z.infer<typeof NodeInfoSchema>;

/**
 * Detect Node.js projects by looking for package.json, and pick the package manager
 * from the lockfile. Pure: the lockfile's name is enough, its contents are never read.
 * The same table and rule as the project's packageManager, so tasks and scripts agree: a workspace
 * package takes the root's lockfile first.
 */
export async function detectNode(
  _dir: string,
  files: ReadonlySet<string>,
  _dirs: ReadonlySet<string>,
  ctx?: DetectContext,
): Promise<NodeInfo | null> {
  if (!files.has('package.json')) return null;
  const inherited = ctx?.root ? detectPackageManager(ctx.root.files) : null;
  return { packageManager: inherited ?? detectPackageManager(files) ?? 'npm' };
}
