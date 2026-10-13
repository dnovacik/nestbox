// The one lockfile -> package manager table: a project's packageManager (which runs its scripts) and the Node
// module's info (install, ci, the summary) both come from here, so they never disagree.
import type { PackageManager } from '@shared/detected';

/** In priority order: with several lockfiles, the first found wins. */
const LOCKFILES: ReadonlyArray<readonly [string, PackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
];

export function detectPackageManager(fileNames: ReadonlySet<string>): PackageManager | null {
  return LOCKFILES.find(([file]) => fileNames.has(file))?.[1] ?? null;
}
