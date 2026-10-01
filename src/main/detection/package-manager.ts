import type { PackageManager } from '@shared/detected';

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
