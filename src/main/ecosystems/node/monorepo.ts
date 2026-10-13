// Workspace-wide tasks on a monorepo root: a script that several packages define, run in every package
// through the package manager, and Turborepo's tasks from turbo.json. Names only; script text is never kept.
import { join } from 'node:path';
import { parse } from 'jsonc-parser';
import { z } from 'zod';
import type { DetectedTask } from '../types';
import type { NodeInfo } from './detect';
import { readPackageJson, readSmall } from './package-json';
import { nodeWorkspaces } from './workspaces';

export const MonorepoSchema = z.object({
  /** Script names that two or more workspace packages define (plain words only, at most 20). */
  shared: z.array(z.string()),
  /** turbo.json's task names (plain, without `#`) when turbo is a root dependency. */
  turbo: z.array(z.string()),
  /** Yarn 2+ (`.yarnrc.yml` at the root) runs a script everywhere with `workspaces foreach`. */
  yarnBerry: z.boolean(),
});
export type Monorepo = z.infer<typeof MonorepoSchema>;

/** A name that reaches cmd.exe as one plain word. */
const PLAIN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$/;
const MAX_PACKAGES = 50;
const MAX_NAMES = 20;
const TURBO_MAX_BYTES = 64 * 1024;

function keysOf(value: unknown): string[] {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
}

async function turboTasks(dir: string, files: ReadonlySet<string>, json: Record<string, unknown>) {
  const installed = ['dependencies', 'devDependencies'].some((f) =>
    keysOf(json[f]).includes('turbo'),
  );
  if (!installed || !files.has('turbo.json')) return [];
  const text = await readSmall(join(dir, 'turbo.json'), TURBO_MAX_BYTES);
  if (!text) return [];
  const config: unknown = parse(text);
  if (!config || typeof config !== 'object') return [];
  const { tasks, pipeline } = config as Record<string, unknown>;
  // `web#build` targets one package and `//#lint` the root: only tasks that run everywhere.
  return keysOf(tasks ?? pipeline)
    .filter((name) => !name.includes('#') && PLAIN.test(name))
    .slice(0, MAX_NAMES);
}

/**
 * A root that declares workspaces (null otherwise): the script names its packages share and turbo.json's
 * tasks. Reads each package's package.json (capped, at most 50 packages).
 */
export async function detectMonorepo(
  dir: string,
  files: ReadonlySet<string>,
  json: Record<string, unknown> | null,
): Promise<Monorepo | null> {
  if (!json) return null;
  const packages = await nodeWorkspaces(dir).catch(() => null);
  if (packages === null) return null;
  const counts = new Map<string, number>();
  for (const relPath of packages.slice(0, MAX_PACKAGES)) {
    const pkg = await readPackageJson(join(dir, relPath));
    for (const name of keysOf(pkg?.['scripts'])) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const shared = [...counts]
    .filter(([name, count]) => count >= 2 && PLAIN.test(name))
    .map(([name]) => name)
    .sort()
    .slice(0, MAX_NAMES);
  return { shared, turbo: await turboTasks(dir, files, json), yarnBerry: files.has('.yarnrc.yml') };
}

function everywhere(info: NodeInfo, script: string, yarnBerry: boolean): string[] {
  switch (info.packageManager) {
    case 'pnpm':
      return ['pnpm', '-r', 'run', script];
    case 'npm':
      return ['npm', 'run', script, '--workspaces', '--if-present'];
    case 'yarn':
      return yarnBerry
        ? ['yarn', 'workspaces', 'foreach', '-A', 'run', script]
        : ['yarn', 'workspaces', 'run', script];
    case 'bun':
      return ['bun', 'run', '--filter', '*', script];
  }
}

/** The installed turbo through the package manager (`npm exec --no` refuses to download it). */
function turbo(info: NodeInfo, task: string): string[] {
  switch (info.packageManager) {
    case 'npm':
      return ['npm', 'exec', '--no', '--', 'turbo', 'run', task];
    case 'pnpm':
      return ['pnpm', 'exec', 'turbo', 'run', task];
    case 'yarn':
      return ['yarn', 'turbo', 'run', task];
    case 'bun':
      // A package.json bin from node_modules/.bin, never a download.
      return ['bun', 'run', 'turbo', 'run', task];
  }
}

export function monorepoTasks(info: NodeInfo): DetectedTask[] {
  const repo = info.monorepo;
  if (!repo) return [];
  return [
    ...repo.shared.map((script) => ({
      name: `all:${script}`,
      argv: everywhere(info, script, repo.yarnBerry),
      title: `Run ${script} in every package`,
    })),
    ...repo.turbo.map((task) => ({
      name: `turbo:${task}`,
      argv: turbo(info, task),
      title: `turbo run ${task}`,
    })),
  ];
}
