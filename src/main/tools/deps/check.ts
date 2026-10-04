// One package's dependency check: its direct dependencies (package.json), what is installed (node_modules),
// the package manager's outdated and audit results, merged into rows. Commands go through `run`, so tests
// fake them and the tool runs them through the platform adapter.
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import semver from 'semver';
import type { PackageManager } from '@shared/detected';
import type { Advisory, DepRow, DepType, StepError } from '@shared/tools/deps/contract';
import {
  type Outdated,
  parseBerryAudit,
  parseBunAudit,
  parseNpmAudit,
  parseNpmOutdated,
  parsePnpmAudit,
  parsePnpmOutdated,
  parseYarn1Audit,
  parseYarn1Outdated,
  type Vulns,
} from './parse';

export interface RunResult {
  /** null when the command timed out or couldn't start. */
  code: number | null;
  stdout: string;
  timedOut: boolean;
}
export type Run = (command: string, args: string[]) => Promise<RunResult>;

export const MAX_ROWS = 1_000;
export const MAX_FALLBACK_DEPS = 200;
const FALLBACK_CONCURRENCY = 4;
const PACKAGE_JSON_MAX = 1024 * 1024;
const MANIFEST_MAX = 256 * 1024;
/** npm's package name rule, so a name from package.json is safe on a command line. */
const NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i;

const DEP_FIELDS: [string, DepType][] = [
  ['dependencies', 'prod'],
  ['devDependencies', 'dev'],
  ['optionalDependencies', 'optional'],
  ['peerDependencies', 'peer'],
];

export interface Direct {
  name: string;
  type: DepType;
  range: string;
}

async function readJson(path: string, max: number): Promise<Record<string, unknown> | null> {
  let handle;
  try {
    handle = await open(path, 'r');
  } catch {
    return null;
  }
  try {
    if ((await handle.stat()).size > max) return null;
    const value: unknown = JSON.parse(await handle.readFile('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

/** Direct dependencies, first field wins (a package in both dependencies and peerDependencies is prod). */
export async function readDirect(dir: string): Promise<Direct[]> {
  const json = await readJson(join(dir, 'package.json'), PACKAGE_JSON_MAX);
  const out: Direct[] = [];
  for (const [field, type] of DEP_FIELDS) {
    const deps = json?.[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, range] of Object.entries(deps as Record<string, unknown>)) {
      if (typeof range !== 'string' || !NAME.test(name) || out.some((d) => d.name === name)) continue;
      out.push({ name, type, range });
      if (out.length >= MAX_ROWS) return out;
    }
  }
  return out;
}

/** The installed version from node_modules; null with Plug'n'Play or when it isn't installed. */
export async function installedVersion(dir: string, name: string): Promise<string | null> {
  const json = await readJson(join(dir, 'node_modules', ...name.split('/'), 'package.json'), MANIFEST_MAX);
  const version = json?.['version'];
  return typeof version === 'string' && semver.valid(version) ? version : null;
}

export type Flavour = PackageManager | 'yarn-berry';

/** Yarn 1 and Yarn 2+ share a command name but nothing else. */
export async function flavourOf(manager: PackageManager, run: Run): Promise<Flavour> {
  if (manager !== 'yarn') return manager;
  const { code, stdout } = await run('yarn', ['--version']);
  const major = code === 0 ? semver.major(semver.coerce(stdout.trim()) ?? '1.0.0') : 1;
  return major >= 2 ? 'yarn-berry' : 'yarn';
}

interface RegistryInfo {
  versions: string[];
  latest: string | null;
}

/** Registry data through the package manager (its registry and auth), for managers without JSON outdated. */
async function registryInfo(flavour: 'yarn-berry' | 'bun', name: string, run: Run): Promise<RegistryInfo | null> {
  const parse = (text: string): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };
  if (flavour === 'yarn-berry') {
    const { code, stdout } = await run('yarn', ['npm', 'info', name, '--fields', 'versions,dist-tags', '--json']);
    const value = code === 0 ? parse(stdout) : null;
    if (!value || typeof value !== 'object') return null;
    const v = value as { versions?: unknown; 'dist-tags'?: { latest?: unknown } };
    return {
      versions: Array.isArray(v.versions) ? v.versions.filter((x): x is string => typeof x === 'string') : [],
      latest: typeof v['dist-tags']?.latest === 'string' ? v['dist-tags'].latest : null,
    };
  }
  const versions = await run('bun', ['pm', 'view', name, 'versions', '--json']);
  const tags = await run('bun', ['pm', 'view', name, 'dist-tags', '--json']);
  const list = versions.code === 0 ? parse(versions.stdout) : null;
  const latest = tags.code === 0 ? (parse(tags.stdout) as { latest?: unknown } | null)?.latest : null;
  if (!Array.isArray(list)) return null;
  return { versions: list.filter((x): x is string => typeof x === 'string'), latest: typeof latest === 'string' ? latest : null };
}

/** Outdated entries computed from installed versions and the registry; null when the registry wasn't reached. */
export async function fallbackOutdated(
  flavour: 'yarn-berry' | 'bun',
  direct: readonly Direct[],
  installed: ReadonlyMap<string, string | null>,
  run: Run,
): Promise<Outdated[] | null> {
  const candidates = direct.filter((d) => semver.validRange(d.range) !== null).slice(0, MAX_FALLBACK_DEPS);
  const out: Outdated[] = [];
  let reached = 0;
  let next = 0;
  const worker = async () => {
    while (next < candidates.length) {
      const dep = candidates[next++] as Direct;
      const info = await registryInfo(flavour, dep.name, run);
      if (!info) continue;
      reached++;
      const current = installed.get(dep.name) ?? null;
      const wanted = semver.maxSatisfying(info.versions, dep.range);
      const behind = (target: string | null) => target !== null && (current === null || semver.lt(current, target));
      if (behind(wanted) || behind(info.latest)) out.push({ name: dep.name, current, wanted, latest: info.latest });
    }
  };
  await Promise.all(Array.from({ length: FALLBACK_CONCURRENCY }, worker));
  if (candidates.length > 0 && reached === 0) return null;
  // Workers finish in any order: keep package.json's.
  return candidates.flatMap((d) => out.filter((o) => o.name === d.name));
}

const OUTDATED: Record<'npm' | 'pnpm' | 'yarn', { args: string[]; parse: (text: string) => Outdated[] | null }> = {
  npm: { args: ['outdated', '--json'], parse: parseNpmOutdated },
  pnpm: { args: ['outdated', '--format', 'json'], parse: parsePnpmOutdated },
  yarn: { args: ['outdated', '--json'], parse: parseYarn1Outdated },
};

const AUDIT: Record<Flavour, { command: string; args: string[]; parse: (text: string) => Vulns | null }> = {
  npm: { command: 'npm', args: ['audit', '--json'], parse: parseNpmAudit },
  pnpm: { command: 'pnpm', args: ['audit', '--json'], parse: parsePnpmAudit },
  yarn: { command: 'yarn', args: ['audit', '--json'], parse: parseYarn1Audit },
  'yarn-berry': { command: 'yarn', args: ['npm', 'audit', '--json'], parse: parseBerryAudit },
  bun: { command: 'bun', args: ['audit', '--json'], parse: parseBunAudit },
};

function baseVersion(current: string | null, wanted: string | null): string | null {
  return semver.valid(current) ?? semver.valid(wanted);
}

export function mergeRows(
  direct: readonly Direct[],
  installed: ReadonlyMap<string, string | null>,
  outdated: readonly Outdated[],
  vulns: Vulns,
): DepRow[] {
  const byName = new Map(outdated.map((o) => [o.name, o]));
  const row = (name: string, type: DepType | null, range: string | null): DepRow => {
    const o = byName.get(name);
    const current = installed.get(name) ?? o?.current ?? null;
    const wanted = o?.wanted ?? null;
    const latest = o?.latest ?? null;
    const base = baseVersion(current, wanted);
    const lt = (a: string | null, b: string | null) => semver.valid(a) !== null && semver.valid(b) !== null && semver.lt(a as string, b as string);
    const isOutdated = o !== undefined && (current === null || lt(current, wanted) || lt(current, latest));
    const advisories: Advisory[] = vulns.get(name) ?? [];
    return {
      name,
      type,
      range,
      current,
      wanted,
      latest,
      outdated: isOutdated,
      major: isOutdated && base !== null && semver.valid(latest) !== null && semver.major(latest as string) > semver.major(base),
      advisories,
    };
  };
  const rows = direct.map((d) => row(d.name, d.type, d.range));
  const known = new Set(direct.map((d) => d.name));
  for (const name of [...byName.keys(), ...vulns.keys()]) {
    if (known.has(name)) continue;
    known.add(name);
    rows.push(row(name, null, null));
  }
  return rows.slice(0, MAX_ROWS);
}

const stepError = (step: StepError['step'], r: RunResult): StepError => ({ step, code: r.timedOut ? 'timeout' : 'failed' });

export async function checkPackage(dir: string, manager: PackageManager, run: Run): Promise<{ rows: DepRow[]; errors: StepError[] }> {
  const direct = await readDirect(dir);
  const installed = new Map<string, string | null>();
  for (const d of direct) installed.set(d.name, await installedVersion(dir, d.name));
  const flavour = await flavourOf(manager, run);
  const errors: StepError[] = [];

  let outdated: Outdated[] = [];
  if (flavour === 'yarn-berry' || flavour === 'bun') {
    const result = await fallbackOutdated(flavour, direct, installed, run);
    if (result) outdated = result;
    else errors.push({ step: 'outdated', code: 'failed' });
  } else {
    const spec = OUTDATED[flavour];
    const r = await run(flavour, spec.args);
    const parsed = r.code === null ? null : spec.parse(r.stdout);
    if (parsed) outdated = parsed;
    else errors.push(stepError('outdated', r));
  }

  let vulns: Vulns = new Map();
  const audit = AUDIT[flavour];
  const r = await run(audit.command, audit.args);
  const parsed = r.code === null ? null : audit.parse(r.stdout);
  if (parsed) vulns = parsed;
  else errors.push(stepError('audit', r));

  return { rows: mergeRows(direct, installed, outdated, vulns), errors };
}

/** The command that updates one dependency to its latest version, as the package manager spells it. */
export function updateCommand(flavour: Flavour, name: string, type: DepType | null): string {
  const dev = type === 'dev';
  switch (flavour) {
    case 'npm':
      return `npm install ${dev ? '-D ' : ''}${name}@latest`;
    case 'pnpm':
      return `pnpm add ${dev ? '-D ' : ''}${name}@latest`;
    case 'yarn':
      return `yarn upgrade ${name}@latest`;
    case 'yarn-berry':
      return `yarn up ${name}@latest`;
    case 'bun':
      return `bun add ${dev ? '-d ' : ''}${name}@latest`;
  }
}
