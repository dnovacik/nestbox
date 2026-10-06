// Env variable names a package's source reads (os.getenv("X"), process.env.X, …). File contents stay in
// memory: only the names leave this module, for display; they are never logged or stored.
import { realpath } from 'node:fs/promises';
import { resolveInside } from '../../fs/inside';
import { readSourceText } from '../../fs/source-text';

export const MAX_CODE_FILES = 5_000;
const TIME_LIMIT_MS = 10_000;

const SOURCE_FILE = /\.(py|js|jsx|ts|tsx|mjs|cjs|mts|cts|vue|svelte)$/i;
/** Third-party code in a package folder: a virtualenv at its top, installed packages, caches. */
const SKIP_PATH = /^(\.venv|venv|env)\/|(^|\/)(\.venv|site-packages|__pycache__|node_modules)\//;

const NAME = String.raw`(?<name>[A-Za-z_][A-Za-z0-9_]*)`;
const QUOTED = String.raw`\s*(?<quote>['"])${NAME}\k<quote>`;
const PATTERNS = [
  // os.getenv("X", getenv("X", os.environ.get("X", environ.setdefault("X"
  new RegExp(String.raw`\b(?:getenv|environ\.get|environ\.setdefault)\(${QUOTED}`, 'g'),
  // os.environ["X"], process.env["X"]
  new RegExp(String.raw`\b(?:environ|process\.env)\[${QUOTED}\s*\]`, 'g'),
  // process.env.X, import.meta.env.X
  new RegExp(String.raw`\b(?:process\.env|import\.meta\.env)\.${NAME}`, 'g'),
];

/** Set by the system, the shell or the toolchain, not by the project's env files. */
const NOT_PROJECT_KEYS = new Set([
  'PATH',
  'HOME',
  'USER',
  'USERNAME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'TMPDIR',
  'SHELL',
  'PWD',
  'LANG',
  'TERM',
  'CI',
  'NODE_ENV',
  'DEV',
  'PROD',
  'MODE',
  'SSR',
  'BASE_URL',
  'PYTHONPATH',
  'VIRTUAL_ENV',
  'PYTHONUNBUFFERED',
]);

/** The names a source text reads, in order of first appearance. */
export function findEnvKeys(text: string): string[] {
  const found: { key: string; at: number }[] = [];
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const key = match.groups?.['name'];
      if (key !== undefined && !NOT_PROJECT_KEYS.has(key)) found.push({ key, at: match.index });
    }
  }
  return [...new Set(found.sort((a, b) => a.at - b.at).map((f) => f.key))];
}

export interface CodeKeys {
  /** Sorted by name; `files` is how many source files read the key. */
  keys: { key: string; files: number }[];
  /** Source files read. */
  files: number;
  truncated: boolean;
}

export async function scanCodeKeys(
  dir: string,
  paths: readonly string[],
  opts: { maxFiles?: number; now?: () => number } = {},
): Promise<CodeKeys> {
  const maxFiles = opts.maxFiles ?? MAX_CODE_FILES;
  const now = opts.now ?? Date.now;
  const started = now();
  const realRoot = await realpath(dir).catch(() => dir);
  const sources = paths.filter(
    (p) => SOURCE_FILE.test(p) && !SKIP_PATH.test(p.replace(/\\/g, '/')),
  );
  const counts = new Map<string, number>();
  let files = 0;
  let truncated = sources.length > maxFiles;
  for (const path of sources.slice(0, maxFiles)) {
    if (now() - started > TIME_LIMIT_MS) {
      truncated = true;
      break;
    }
    let abs: string;
    try {
      abs = resolveInside(dir, path);
    } catch {
      continue;
    }
    const text = await readSourceText(realRoot, abs);
    if (text === null) continue;
    files++;
    for (const key of findEnvKeys(text)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const keys = [...counts]
    .map(([key, n]) => ({ key, files: n }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return { keys, files, truncated };
}
