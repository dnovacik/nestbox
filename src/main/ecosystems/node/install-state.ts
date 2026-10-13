// Whether a Node package's dependencies are installed and newer than its lockfile: a fresh clone, a pull that
// changed the lockfile, a switched branch. Stat calls only (mtimes), no hashing, no network, no subprocess.
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { NodeInfo } from './detect';

export type InstallState = 'ok' | 'missing' | 'stale';

/** What each manager writes when an install finishes; Bun writes none, so its node_modules folder stands in. */
const MARKERS: Record<NodeInfo['packageManager'], string[]> = {
  npm: ['node_modules/.package-lock.json'],
  pnpm: ['node_modules/.modules.yaml'],
  // Yarn 1, then Yarn 2+ (which also writes it with Plug'n'Play).
  yarn: ['node_modules/.yarn-integrity', '.yarn/install-state.gz'],
  bun: ['node_modules'],
};

async function mtimeOf(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Null when there is nothing to install. A workspace package installs at its root (rootDir), whose
 * node_modules and lockfile count. Ok when it can't tell (no lockfile, no marker to compare).
 */
export async function installState(
  dir: string,
  rootDir: string | null,
  info: NodeInfo,
): Promise<InstallState | null> {
  if (!info.hasDependencies) return null;
  const installDir = rootDir ?? dir;
  const modules = await mtimeOf(join(installDir, 'node_modules'));
  const pnp = await mtimeOf(join(installDir, '.pnp.cjs'));
  if (modules === null && pnp === null) return 'missing';
  const lockfile = info.lockfiles[0];
  const locked = lockfile ? await mtimeOf(join(installDir, lockfile)) : null;
  if (locked === null) return 'ok';
  for (const marker of MARKERS[info.packageManager]) {
    const installed = await mtimeOf(join(installDir, marker));
    if (installed !== null) return locked > installed ? 'stale' : 'ok';
  }
  return 'ok';
}

/** The run advice's warning, or null. */
export function installWarning(state: InstallState | null): string | null {
  if (state === 'missing') return "Dependencies aren't installed (run install)";
  if (state === 'stale') return 'Dependencies are older than the lockfile (run install)';
  return null;
}
