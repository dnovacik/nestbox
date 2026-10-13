// The one lockfile -> package manager table: a project's packageManager (which runs its scripts) and the Node
// module's info (install, ci, the summary) both come from here, so they never disagree.
import type { PackageManager } from '@shared/detected';
import { parsePackageManager } from './versions';

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

export const PACKAGE_MANAGER_SOURCES = ['lockfile', 'packageManager', 'default'] as const;
export type PackageManagerSource = (typeof PACKAGE_MANAGER_SOURCES)[number];

interface ManagerInputs {
  files: ReadonlySet<string>;
  /** package.json's `packageManager` (Corepack's `name@version`); read only when no lockfile decides. */
  field?: unknown;
}

/**
 * Which manager runs a package: a lockfile (what was actually installed), then package.json's
 * `packageManager`, then npm. A workspace package takes the root's lockfile first, then the root's field.
 */
export function choosePackageManager(
  o: ManagerInputs & { root?: ManagerInputs | null },
): { manager: PackageManager; source: PackageManagerSource } {
  const locked = (o.root ? detectPackageManager(o.root.files) : null) ?? detectPackageManager(o.files);
  if (locked) return { manager: locked, source: 'lockfile' };
  const declared = (o.root ? parsePackageManager(o.root.field) : null) ?? parsePackageManager(o.field);
  if (declared) return { manager: declared.name, source: 'packageManager' };
  return { manager: 'npm', source: 'default' };
}
