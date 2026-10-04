// What the platforms' own files say about a package: whether it's linked and under which name. Small files
// only (64 KiB), read on every status call; nothing here touches the network or runs a CLI.
import { open, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DeployPlatform } from '@shared/detected';

const MAX_BYTES = 64 * 1024;
const WRANGLER_FILES = ['wrangler.toml', 'wrangler.json', 'wrangler.jsonc'];

export interface LocalConfig {
  linked: boolean;
  name: string | null;
  flavour: 'workers' | 'pages' | null;
}

async function readSmall(path: string): Promise<string | null> {
  let handle;
  try {
    handle = await open(path, 'r');
  } catch {
    return null;
  }
  try {
    if ((await handle.stat()).size > MAX_BYTES) return null;
    return await handle.readFile('utf8');
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** A top-level `key = "value"` (or single quotes) before the first `[table]`; enough for names. */
export function tomlTopLevel(text: string, key: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) return null;
    const m = /^\s*([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*(?:#.*)?$/.exec(line);
    if (m && m[1] === key) return str(m[2] ?? m[3]);
  }
  return null;
}

/** JSON with comments and trailing commas (wrangler.jsonc); null unless it's an object. */
export function parseJsonc(text: string): Record<string, unknown> | null {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const end = /"(?:[^"\\]|\\.)*"/y;
      end.lastIndex = i;
      const m = end.exec(text);
      if (!m) return null;
      out += m[0];
      i += m[0].length - 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      if (close === -1) return null;
      i = close + 1;
    } else {
      out += c;
    }
  }
  try {
    const value: unknown = JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
    return isObj(value) ? value : null;
  } catch {
    return null;
  }
}

async function readJsonObject(path: string): Promise<Record<string, unknown> | null> {
  const text = await readSmall(path);
  return text === null ? null : parseJsonc(text);
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null)) !== null;
}

/** Netlify links a repository: `.netlify/state.json` in the package, or a parent up to the one with `.git`. */
async function netlifySiteId(dir: string): Promise<string | null> {
  for (let current = dir; ;) {
    const siteId = str((await readJsonObject(join(current, '.netlify', 'state.json')))?.['siteId']);
    if (siteId) return siteId;
    const parent = dirname(current);
    if (parent === current || (await exists(join(current, '.git')))) return null;
    current = parent;
  }
}

/** The first wrangler config: TOML text or a parsed JSON(C) object. */
async function wranglerConfig(
  dir: string,
): Promise<{ toml: string } | { json: Record<string, unknown> | null } | null> {
  for (const file of WRANGLER_FILES) {
    const text = await readSmall(join(dir, file));
    if (text === null) continue;
    return file.endsWith('.toml') ? { toml: text } : { json: parseJsonc(text) };
  }
  return null;
}

/** Environment names that may reach a command line (`--env <name>`). */
export const ENV_NAME = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;

const TABLE_HEADER = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/;

/** The keys of a TOML `[table]` (bare keys only), up to the next header. */
export function tomlTableKeys(text: string, table: string): string[] {
  const keys: string[] = [];
  let inside = false;
  for (const line of text.split(/\r?\n/)) {
    const header = TABLE_HEADER.exec(line);
    if (header) {
      inside = header[1]?.trim() === table;
      continue;
    }
    const key = inside ? /^\s*([A-Za-z0-9_-]+)\s*=/.exec(line)?.[1] : undefined;
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** Named Workers environments (`[env.<name>]` or `env: { <name>: … }`), in file order. */
export async function wranglerEnvironments(dir: string): Promise<string[]> {
  const config = await wranglerConfig(dir);
  if (config === null) return [];
  let names: string[] = [];
  if ('toml' in config) {
    for (const line of config.toml.split(/\r?\n/)) {
      const name = /^env\.([^.\s]+)(?:\.|$)/.exec(TABLE_HEADER.exec(line)?.[1]?.trim() ?? '')?.[1];
      if (name !== undefined) names.push(name);
    }
  } else {
    const env = config.json?.['env'];
    names = isObj(env) ? Object.keys(env) : [];
  }
  return [...new Set(names)].filter((n) => ENV_NAME.test(n));
}

/** Variables the platform gets from the config file itself: wrangler `vars` (per environment), fly.toml `[env]`. */
export async function configVarKeys(
  platform: DeployPlatform,
  dir: string,
  environment: string,
): Promise<string[]> {
  if (platform === 'fly') {
    const text = await readSmall(join(dir, 'fly.toml'));
    return text === null ? [] : tomlTableKeys(text, 'env');
  }
  if (platform !== 'cloudflare') return [];
  const config = await wranglerConfig(dir);
  if (config === null) return [];
  // Workers' top level is "production" here; its named environments don't inherit `vars`. Pages
  // environments (production, preview) use the top-level `vars` unless they override them.
  const pages =
    'toml' in config
      ? tomlTopLevel(config.toml, 'pages_build_output_dir') !== null
      : str(config.json?.['pages_build_output_dir']) !== null;
  const named = pages || environment !== 'production';
  const read = (env: string | null): string[] | null => {
    if ('toml' in config) {
      const table = env === null ? 'vars' : `env.${env}.vars`;
      return hasTable(config.toml, table) ? tomlTableKeys(config.toml, table) : null;
    }
    const envs = config.json?.['env'];
    const scope = env === null ? config.json : isObj(envs) ? envs[env] : undefined;
    const vars = isObj(scope) ? scope['vars'] : undefined;
    return isObj(vars) ? Object.keys(vars) : null;
  };
  if (!named) return read(null) ?? [];
  return read(environment) ?? (pages ? (read(null) ?? []) : []);
}

function hasTable(text: string, table: string): boolean {
  return text.split(/\r?\n/).some((line) => TABLE_HEADER.exec(line)?.[1]?.trim() === table);
}

async function wrangler(dir: string): Promise<LocalConfig> {
  for (const file of WRANGLER_FILES) {
    const text = await readSmall(join(dir, file));
    if (text === null) continue;
    let name: string | null;
    let pages: boolean;
    if (file.endsWith('.toml')) {
      name = tomlTopLevel(text, 'name');
      pages = tomlTopLevel(text, 'pages_build_output_dir') !== null;
    } else {
      const json = parseJsonc(text);
      name = str(json?.['name']);
      pages = str(json?.['pages_build_output_dir']) !== null;
    }
    return { linked: name !== null, name, flavour: pages ? 'pages' : 'workers' };
  }
  return { linked: false, name: null, flavour: 'workers' };
}

export async function readLocalConfig(platform: DeployPlatform, dir: string): Promise<LocalConfig> {
  switch (platform) {
    case 'vercel': {
      const project = await readJsonObject(join(dir, '.vercel', 'project.json'));
      const linked = str(project?.['projectId']) !== null;
      return { linked, name: linked ? str(project?.['projectName']) : null, flavour: null };
    }
    case 'netlify':
      return { linked: (await netlifySiteId(dir)) !== null, name: null, flavour: null };
    case 'cloudflare':
      return wrangler(dir);
    case 'fly': {
      const text = await readSmall(join(dir, 'fly.toml'));
      const name = text === null ? null : tomlTopLevel(text, 'app');
      return { linked: name !== null, name, flavour: null };
    }
  }
}
