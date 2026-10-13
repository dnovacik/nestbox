// The workspaces a Node root declares: `packages` in pnpm-workspace.yaml and `workspaces` in package.json
// (an array, or Yarn's { packages }). Patterns that could leave the root are dropped before globbing; the
// generic detection checks every folder found against the root again (symlinks included).
import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { glob } from 'tinyglobby';
import { parse as parseYaml } from 'yaml';
import { isRecord } from '@shared/is-record';
import { escapesRoot } from '../../fs/inside';
import type { WorkspaceContext } from '../types';

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

async function pnpmPatterns(root: string, ctx: WorkspaceContext): Promise<string[]> {
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
    ctx.onWarning?.('pnpm-workspace.yaml', 'invalid-yaml');
    return [];
  }
}

/** The root package.json's workspaces. Unreadable or invalid JSON is none: detection already warned about it. */
async function packageJsonPatterns(root: string): Promise<string[]> {
  let pkg: unknown;
  try {
    const text = await readFile(join(root, 'package.json'), 'utf8');
    pkg = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return [];
  }
  if (!isRecord(pkg)) return [];
  const ws = pkg['workspaces'];
  if (Array.isArray(ws)) return strings(ws);
  if (isRecord(ws)) return strings(ws['packages']);
  return [];
}

function clean(pattern: string): string {
  return pattern.trim().replace(/^\.\//, '').replace(/\/+$/, '');
}

/** The folder of a file path from a glob, with `/` separators. */
const folderOf = (file: string): string => posix.dirname(file.replace(/\\/g, '/'));

/** Folders holding a package.json that the patterns include; null when the root declares no workspaces. */
export async function nodeWorkspaces(
  root: string,
  ctx: WorkspaceContext = {},
): Promise<string[] | null> {
  const patterns = [...(await pnpmPatterns(root, ctx)), ...(await packageJsonPatterns(root))];
  if (patterns.length === 0) return null;
  const include = patterns
    .filter((p) => !p.startsWith('!'))
    .map(clean)
    .filter((p) => p && p !== '.' && !escapesRoot(p));
  const exclude = patterns
    .filter((p) => p.startsWith('!'))
    .map((p) => clean(p.slice(1)))
    .filter((p) => !escapesRoot(p));
  if (include.length === 0) return [];
  const manifests = await glob(
    include.map((p) => `${p}/package.json`),
    {
      cwd: root,
      ignore: ['**/node_modules/**', ...exclude.map((p) => `${p}/package.json`)],
      onlyFiles: true,
    },
  );
  return manifests.map(folderOf);
}
