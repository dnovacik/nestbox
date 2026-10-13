// A project's package folders: those the ecosystems declare (npm/pnpm/yarn workspaces) or, without a
// declaration, the sub-folders holding an ecosystem's package file; plus the folders an ecosystem lists
// itself (a .NET solution's projects). Every folder is checked against the root, symlinks resolved.
import { realpath } from 'node:fs/promises';
import { isAbsolute, join, posix, relative, resolve } from 'node:path';
import { glob } from 'tinyglobby';
import { ECOSYSTEM_MODULES } from '../ecosystems';
import { escapesRoot } from '../fs/inside';
import type { DetectOptions } from './detect-project';

function insideRoot(root: string, dir: string): boolean {
  const rel = relative(resolve(root), resolve(root, dir));
  return !rel.startsWith('..') && !isAbsolute(rel);
}

/** Folders never taken as packages when looking for them without a workspaces config. */
const NOT_PACKAGES = [
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  'tmp',
  'test',
  'tests',
  'e2e',
  'fixtures',
  '__fixtures__',
  'examples',
  'example',
];

/** The folder of a file path from a glob, with `/` separators. */
const folderOf = (file: string): string => posix.dirname(file.replace(/\\/g, '/'));

/**
 * A folder like shop/ holding app/ and api/ but no workspaces config: its packages are the folders one or
 * two levels down holding an ecosystem's package file (package.json, a .csproj, …).
 */
async function subFolderPackages(root: string): Promise<string[]> {
  const ignore = NOT_PACKAGES.flatMap((name) => [`${name}/**`, `*/${name}/**`]);
  const found = await Promise.all(
    ECOSYSTEM_MODULES.map(async (module) => {
      const files = await glob(module.packageGlobs, { cwd: root, ignore, onlyFiles: true, dot: false });
      return files
        .map(folderOf)
        .filter((dir) => !dir.split('/').some((name) => module.skipDir?.(name)));
    }),
  );
  return found.flat();
}

/** Folders the ecosystems list themselves (a solution's projects), whatever the workspaces config says. */
async function listedPackages(root: string): Promise<string[]> {
  const listed = await Promise.all(ECOSYSTEM_MODULES.map((m) => m.workspaceDirs?.(root) ?? []));
  return listed.flat().filter((dir) => !escapesRoot(dir));
}

/** The declared workspaces of every ecosystem that has some; null when none declares any. */
async function declaredPackages(root: string, options: DetectOptions): Promise<string[] | null> {
  const declared = await Promise.all(
    ECOSYSTEM_MODULES.map((m) => m.declaredWorkspaces?.(root, options) ?? null),
  );
  const lists = declared.filter((d): d is string[] => d !== null);
  return lists.length === 0 ? null : lists.flat();
}

export async function findWorkspaceDirs(
  root: string,
  options: DetectOptions = {},
): Promise<string[]> {
  const listed = await listedPackages(root);
  const declared = await declaredPackages(root, options);
  return keepInside(root, [...(declared ?? (await subFolderPackages(root))), ...listed], options);
}

/** Package folders: sorted, unique, never the root, and only existing ones really inside it. */
async function keepInside(root: string, folders: string[], options: DetectOptions): Promise<string[]> {
  const dirs = new Set(folders);
  dirs.delete('.');
  const realRoot = await realpath(root).catch(() => resolve(root));
  const kept: string[] = [];
  for (const dir of [...dirs].filter((d) => insideRoot(root, d)).sort()) {
    // A symlinked (or junctioned) folder can point anywhere: only keep it when its target is inside the root.
    const real = await realpath(join(root, ...dir.split('/'))).catch(() => null);
    if (real === null) continue;
    if (insideRoot(realRoot, real)) kept.push(dir);
    else options.onWarning?.(dir, 'outside-root');
  }
  return kept;
}
