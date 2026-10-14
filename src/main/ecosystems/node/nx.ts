// Nx workspaces, from files only (never `nx show`, which runs Nx): the root's nx.json targetDefaults and
// each project's project.json targets. Names only; a target's options are never kept. Plugin-inferred
// targets aren't listed.
import { join } from 'node:path';
import { parse } from 'jsonc-parser';
import { glob } from 'tinyglobby';
import { PLAIN } from './names';
import { readPackageJson, readSmall } from './package-json';

const CONFIG_MAX_BYTES = 64 * 1024;
const MAX_PROJECTS = 200;
const MAX_PROJECT_TARGETS = 30;
const MAX_ROOT_TARGETS = 20;

/** An Nx project name as it reaches the command line: npm-style, optionally scoped. */
const NX_PROJECT = /^@?[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/;

/** Folders that never hold a project of the workspace's own (dependencies, output, caches). */
const SKIP = ['node_modules', 'dist', 'build', 'out', 'coverage', 'tmp'];

function keysOf(value: unknown): string[] {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
}

async function readJsonc(path: string): Promise<Record<string, unknown> | null> {
  const text = await readSmall(path, CONFIG_MAX_BYTES);
  if (!text) return null;
  const value: unknown = parse(text);
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nxInstalled(json: Record<string, unknown> | null): boolean {
  return ['dependencies', 'devDependencies'].some((field) => keysOf(json?.[field]).includes('nx'));
}

/** nx.json at the root and nx installed there (running it otherwise would download it). */
export function isNxRoot(
  files: ReadonlySet<string>,
  json: Record<string, unknown> | null,
): boolean {
  return files.has('nx.json') && nxInstalled(json);
}

/** The root's Nx project folders (posix, sorted): those holding a project.json, up to four levels down. */
export async function nxProjectDirs(root: string): Promise<string[]> {
  const hasNxJson = (await readSmall(join(root, 'nx.json'), CONFIG_MAX_BYTES)) !== undefined;
  if (!hasNxJson || !nxInstalled(await readPackageJson(root))) return [];
  const files = await glob(
    ['*/project.json', '*/*/project.json', '*/*/*/project.json', '*/*/*/*/project.json'],
    {
      cwd: root,
      ignore: SKIP.flatMap((name) => [`${name}/**`, `**/${name}/**`]),
      onlyFiles: true,
      dot: false,
    },
  );
  return files
    .map((file) => file.replace(/\\/g, '/').replace(/\/project\.json$/, ''))
    .sort()
    .slice(0, MAX_PROJECTS);
}

/**
 * A project's Nx name (project.json's `name`, else the package's) and its plain target names; null when
 * project.json can't be read or the name can't go on a command line.
 */
export async function readNxProject(
  dir: string,
  packageName: string | null,
): Promise<{ project: string; targets: string[] } | null> {
  const config = await readJsonc(join(dir, 'project.json'));
  if (!config) return null;
  const name = typeof config['name'] === 'string' ? config['name'] : packageName;
  if (name === null || !NX_PROJECT.test(name)) return null;
  const targets = keysOf(config['targets'])
    .filter((t) => PLAIN.test(t))
    .sort()
    .slice(0, MAX_PROJECT_TARGETS);
  return { project: name, targets };
}

/** What `nx run-many -t` can run on the root: nx.json's targetDefaults and every project's targets. */
export async function nxRootTargets(
  root: string,
  projectDirs: readonly string[],
): Promise<string[]> {
  const names = new Set(keysOf((await readJsonc(join(root, 'nx.json')))?.['targetDefaults']));
  for (const dir of projectDirs) {
    const config = await readJsonc(join(root, ...dir.split('/'), 'project.json'));
    for (const target of keysOf(config?.['targets'])) names.add(target);
  }
  return [...names]
    .filter((t) => PLAIN.test(t))
    .sort()
    .slice(0, MAX_ROOT_TARGETS);
}
