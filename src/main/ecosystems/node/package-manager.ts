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

/** Every lockfile among the names, in priority order (the first one decides). */
export function lockfilesIn(fileNames: ReadonlySet<string>): string[] {
  return LOCKFILES.filter(([file]) => fileNames.has(file)).map(([file]) => file);
}

const COUNT_WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five'];

/**
 * A half-finished migration or a stray install: lockfiles of more than one manager, which drift apart. Null
 * for one manager's (bun.lockb and bun.lock are both Bun's). NestBox never deletes one: that's the user's call.
 */
export function lockfileWarning(
  lockfiles: readonly string[],
  manager: PackageManager,
): string | null {
  const managers = new Set(lockfiles.map((f) => LOCKFILES.find(([file]) => file === f)?.[1]));
  if (managers.size < 2) return null;
  const names =
    lockfiles.length === 2
      ? lockfiles.join(' and ')
      : `${lockfiles.slice(0, -1).join(', ')} and ${lockfiles.at(-1) ?? ''}`;
  return `${COUNT_WORDS[lockfiles.length] ?? lockfiles.length} lockfiles: ${names}; NestBox uses ${manager}`;
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
export function choosePackageManager(o: ManagerInputs & { root?: ManagerInputs | null }): {
  manager: PackageManager;
  source: PackageManagerSource;
} {
  const locked =
    (o.root ? detectPackageManager(o.root.files) : null) ?? detectPackageManager(o.files);
  if (locked) return { manager: locked, source: 'lockfile' };
  const declared =
    (o.root ? parsePackageManager(o.root.field) : null) ?? parsePackageManager(o.field);
  if (declared) return { manager: declared.name, source: 'packageManager' };
  return { manager: 'npm', source: 'default' };
}
