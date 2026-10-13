// Where `dotnet ef` comes from and which DbContexts a package has. File contents stay in memory here: only
// the tool kind and class names leave.
import { realpath, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { glob } from 'tinyglobby';
import { readSmall } from '../../ecosystems/dotnet/detect';
import { readSourceText } from '../../fs/source-text';

export type EfTool = 'local' | 'global';

const MANIFEST_MAX = 64 * 1024;
/** Where the dotnet CLI looks for a tool manifest in each folder, in its order. */
const MANIFESTS = [join('.config', 'dotnet-tools.json'), 'dotnet-tools.json'];
const MAX_FILES = 2_000;
const MAX_CONTEXTS = 20;

const isFile = (path: string): Promise<boolean> =>
  stat(path).then(
    (s) => s.isFile(),
    () => false,
  );

async function readManifest(path: string): Promise<{ ef: boolean; isRoot: boolean } | null> {
  const text = await readSmall(path, MANIFEST_MAX);
  if (text === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
  const { tools, isRoot } = json as { tools?: unknown; isRoot?: unknown };
  const names = typeof tools === 'object' && tools !== null ? Object.keys(tools) : [];
  return { ef: names.some((n) => n.toLowerCase() === 'dotnet-ef'), isRoot: isRoot === true };
}

/** A local tool from the nearest manifests (as the dotnet CLI finds them), else a global one, else null. */
export async function findEfTool(
  dir: string,
  deps: { commandExists(command: string): Promise<boolean | null>; home: string },
): Promise<EfTool | null> {
  walk: for (let current = dir; ;) {
    for (const name of MANIFESTS) {
      const manifest = await readManifest(join(current, name));
      if (manifest?.ef) return 'local';
      if (manifest?.isRoot) break walk;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if ((await deps.commandExists('dotnet-ef')) === true) return 'global';
  const tools = join(deps.home, '.dotnet', 'tools');
  for (const exe of ['dotnet-ef', 'dotnet-ef.exe'])
    if (await isFile(join(tools, exe))) return 'global';
  return null;
}

/** `class Name[<T>][(primary ctor)] : Base`, with the modifiers before it. */
const CLASS =
  /((?:\b(?:public|internal|private|protected|sealed|partial|abstract|static|file|unsafe|new)\s+)*)class\s+([A-Za-z_][A-Za-z0-9_]*)\s*(<[^>{]*>)?\s*(?:\([^)]*\))?\s*:\s*([A-Za-z_][\w.]*)/g;

/** Class names deriving from a …DbContext type in the package's .cs files (no build, no reflection). */
export async function findDbContexts(dir: string): Promise<string[]> {
  const realRoot = await realpath(dir).catch(() => null);
  if (realRoot === null) return [];
  const files = (
    await glob('**/*.cs', {
      cwd: realRoot,
      dot: false,
      ignore: ['**/bin/**', '**/obj/**', '**/node_modules/**'],
    })
  )
    .sort()
    .slice(0, MAX_FILES);
  const found = new Set<string>();
  for (const rel of files) {
    const text = await readSourceText(realRoot, join(realRoot, rel));
    if (text === null) continue;
    const code = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
    for (const [, modifiers = '', name = '', generic, base = ''] of code.matchAll(CLASS)) {
      // EF can't create an abstract or open generic context.
      if (/\babstract\b/.test(modifiers) || generic !== undefined) continue;
      if (base.split('.').pop()?.endsWith('DbContext')) found.add(name);
    }
  }
  return [...found].sort().slice(0, MAX_CONTEXTS);
}
