import { readFile } from 'node:fs/promises';
import { isAbsolute, join, posix, relative, resolve } from 'node:path';
import { glob } from 'tinyglobby';
import { parse as parseYaml } from 'yaml';
import { isRecord } from '@shared/is-record';
import type { DetectOptions } from './detect-project';

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

export async function findWorkspaceDirs(
  root: string,
  packageJson: Record<string, unknown> | null,
  options: DetectOptions = {},
): Promise<string[]> {
  const patterns = [...(await pnpmPatterns(root, options)), ...packageJsonPatterns(packageJson)];
  if (patterns.length === 0) return [];

  const include = patterns.filter((p) => !p.startsWith('!')).map(clean).filter((p) => p && p !== '.' && !escapesRoot(p));
  const exclude = patterns.filter((p) => p.startsWith('!')).map((p) => clean(p.slice(1))).filter((p) => !escapesRoot(p));
  if (include.length === 0) return [];

  const manifests = await glob(
    include.map((p) => `${p}/package.json`),
    {
      cwd: root,
      ignore: ['**/node_modules/**', ...exclude.map((p) => `${p}/package.json`)],
      onlyFiles: true,
    },
  );
  const dirs = new Set(manifests.map((file) => posix.dirname(file.replace(/\\/g, '/'))));
  dirs.delete('.');
  return [...dirs].filter((dir) => insideRoot(root, dir)).sort();
}
