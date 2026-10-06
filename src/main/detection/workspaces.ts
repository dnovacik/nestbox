import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, posix, relative, resolve } from 'node:path';
import { glob } from 'tinyglobby';
import { parse as parseYaml } from 'yaml';
import { isRecord } from '@shared/is-record';
import type { DetectOptions } from './detect-project';
import { PYTHON_DEFINITION_FILES } from './python';

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

async function pnpmPatterns(root: string, options: DetectOptions): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8');
  } catch {
    return [];
  }
  try {
    const doc: unknown = parseYaml(text);
    return isRecord(doc) ? strings(doc['packages']) : [];
  } catch {
    options.onWarning?.('pnpm-workspace.yaml', 'invalid-yaml');
    return [];
  }
}

function packageJsonPatterns(pkg: Record<string, unknown> | null): string[] {
  if (!pkg) return [];
  const ws = pkg['workspaces'];
  if (Array.isArray(ws)) return strings(ws);
  if (isRecord(ws)) return strings(ws['packages']);
  return [];
}

function clean(pattern: string): string {
  return pattern.trim().replace(/^\.\//, '').replace(/\/+$/, '');
}

/** tinyglobby accepts `../*` and absolute patterns; neither may leave the project root. */
function escapesRoot(pattern: string): boolean {
  return (
    isAbsolute(pattern) ||
    pattern.startsWith('/') ||
    pattern.startsWith('\\') ||
    /^[a-zA-Z]:/.test(pattern) ||
    pattern.split(/[\\/]/).includes('..')
  );
}

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

/**
 * A folder like shop/ holding app/ and api/ (each with its own package.json) but no workspaces config:
 * its packages are the package.json folders one or two levels down.
 */
async function subFolderPackages(root: string): Promise<string[]> {
  const ignore = ignoreDirs(NOT_PACKAGES);
  return glob(['*/package.json', '*/*/package.json'], {
    cwd: root,
    ignore,
    onlyFiles: true,
    dot: false,
  });
}

/** Never Python packages either: virtualenvs and caches. */
const NOT_PYTHON_PACKAGES = [...NOT_PACKAGES, 'venv', 'env', '__pycache__', 'site-packages'];
/** Folders whose loose `.py` files are helpers, not a backend (a definition file still counts). */
const PYTHON_HELPER_DIRS = ['scripts', 'tools', 'bin', 'docs', 'migrations'];

const ignoreDirs = (names: string[]): string[] =>
  names.flatMap((name) => [`${name}/**`, `*/${name}/**`]);

/**
 * Python package manifests: a definition file one or two levels down, or loose `.py` files one level down
 * (`backend/app/main.py` is a module of backend, not a package).
 */
async function pythonManifests(root: string): Promise<string[]> {
  const ignore = ignoreDirs(NOT_PYTHON_PACKAGES);
  const [definitions, sources] = await Promise.all([
    glob(
      PYTHON_DEFINITION_FILES.flatMap((f) => [`*/${f}`, `*/*/${f}`]),
      { cwd: root, ignore, onlyFiles: true, dot: false },
    ),
    glob(['*/*.py'], {
      cwd: root,
      ignore: [...ignore, ...ignoreDirs(PYTHON_HELPER_DIRS)],
      onlyFiles: true,
      dot: false,
    }),
  ]);
  return [...definitions, ...sources];
}

const dirOf = (manifest: string): string => posix.dirname(manifest.replace(/\\/g, '/'));

/** Python manifests whose folder isn't inside another found package (Python or not). */
function outermost(python: string[], js: string[]): string[] {
  const dirs = new Set([...python, ...js].map(dirOf));
  return python.filter((manifest) => {
    const dir = dirOf(manifest);
    return ![...dirs].some((other) => other !== dir && dir.startsWith(`${other}/`));
  });
}

export async function findWorkspaceDirs(
  root: string,
  packageJson: Record<string, unknown> | null,
  options: DetectOptions = {},
): Promise<string[]> {
  const [js, python] = await Promise.all([
    jsManifests(root, packageJson, options),
    pythonManifests(root),
  ]);
  return keepInside(root, [...js, ...outermost(python, js)], options);
}

async function jsManifests(
  root: string,
  packageJson: Record<string, unknown> | null,
  options: DetectOptions,
): Promise<string[]> {
  const patterns = [...(await pnpmPatterns(root, options)), ...packageJsonPatterns(packageJson)];
  if (patterns.length === 0) return subFolderPackages(root);

  const include = patterns
    .filter((p) => !p.startsWith('!'))
    .map(clean)
    .filter((p) => p && p !== '.' && !escapesRoot(p));
  const exclude = patterns
    .filter((p) => p.startsWith('!'))
    .map((p) => clean(p.slice(1)))
    .filter((p) => !escapesRoot(p));
  if (include.length === 0) return [];

  return glob(
    include.map((p) => `${p}/package.json`),
    {
      cwd: root,
      ignore: ['**/node_modules/**', ...exclude.map((p) => `${p}/package.json`)],
      onlyFiles: true,
    },
  );
}

/** Package folders from manifest paths: sorted, never the root, and only those really inside it. */
async function keepInside(
  root: string,
  manifests: string[],
  options: DetectOptions,
): Promise<string[]> {
  const dirs = new Set(manifests.map(dirOf));
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
