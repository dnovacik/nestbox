// Node.js detection of one folder: a package.json, and the package manager from the lockfile's name.
// Pure: no file is read.
import { z } from 'zod';

/**
 * Node.js project info: which package manager runs this package.
 */
export const NodeInfoSchema = z.object({
  /** Package manager detected from the lockfile. */
  packageManager: z.enum(['npm', 'pnpm', 'yarn', 'bun']),
});
export type NodeInfo = z.infer<typeof NodeInfoSchema>;

/**
 * Detect Node.js projects by looking for package.json, and pick the package manager
 * from the lockfile. Pure: the lockfile's name is enough, its contents are never read.
 */
export async function detectNode(
  _dir: string,
  files: ReadonlySet<string>,
  _dirs: ReadonlySet<string>,
): Promise<NodeInfo | null> {
  if (!files.has('package.json')) return null;

  // Priority order: a repo with several lockfiles runs on the one its tooling prefers.
  let packageManager: NodeInfo['packageManager'] = 'npm';
  if (files.has('pnpm-lock.yaml')) packageManager = 'pnpm';
  else if (files.has('bun.lockb')) packageManager = 'bun';
  else if (files.has('yarn.lock')) packageManager = 'yarn';
  else if (files.has('package-lock.json')) packageManager = 'npm';

  return { packageManager };
}
