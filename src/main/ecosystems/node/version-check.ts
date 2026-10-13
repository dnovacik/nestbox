// Which Node version a package needs (version files, engines, Volta), whether the sources agree, and whether
// the Node and package manager that will run its commands match. Read-only, no network: Corepack runs
// offline. With fnm on, commands run on the required version. Shared by the Node tool (its status) and the
// Node module's runEnv (the start advice), through one 30 s cache.
import { dirname, join } from 'node:path';
import type { PackageManager } from '@shared/detected';
import {
  type NodeState,
  type NodeStatus,
  SOURCE_KINDS,
  SOURCE_LABELS,
  type SourceKind,
  type SourceView,
  type StartAdvice,
  type VersionManager,
} from '@shared/tools/node/contract';
import type { PlatformAdapter } from '../../platform/adapter';
import { readPackageJson, readSmall } from './package-json';
import { detectPackageManager, lockfileWarning } from './package-manager';
import {
  conflictingSources,
  parsePackageManager,
  parseRequirement,
  type Requirement,
  satisfies,
} from './versions';

/** One package to check. */
export interface NodeCheckInput {
  dir: string;
  /** The project root's folder for a workspace package (inherited version files and fields); else null. */
  rootDir: string | null;
  /** The package manager its lockfile names (null without one). */
  packageManager: PackageManager | null;
  /** The lockfiles detection found (NodeInfo.lockfiles); more than one manager's gets a warning. */
  lockfiles: readonly string[];
  /** The root project's fnm switch. */
  fnm: boolean;
  platform: PlatformAdapter;
  /** Called after a fresh (uncached) check, e.g. to log its state and duration. */
  onChecked?(state: NodeState, ms: number): void;
}

const CACHE_MS = 30_000;
const FILE_MAX_BYTES = 1024;
const VALUE_MAX = 100;
const NODE_TIMEOUT_MS = 10_000;
const PM_TIMEOUT_MS = 15_000;
/** Corepack must never download a package manager just because NestBox asked for its version. */
const COREPACK_OFFLINE = { COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' };
const VERSION = /^v?\d+\.\d+\.\d+\S*$/;

interface Source extends SourceView {
  requirement: Requirement | null;
}

const FILES: Partial<Record<SourceKind, string>> = {
  nvmrc: '.nvmrc',
  'node-version': '.node-version',
};

function fieldOf(json: Record<string, unknown> | null, kind: 'engines' | 'volta'): unknown {
  const holder = json?.[kind];
  return holder && typeof holder === 'object'
    ? (holder as Record<string, unknown>)['node']
    : undefined;
}

async function readSources(
  dir: string,
  rootDir: string | null,
  json: Record<string, unknown> | null,
  rootJson: Record<string, unknown> | null,
): Promise<Source[]> {
  const sources: Source[] = [];
  for (const kind of SOURCE_KINDS) {
    let text: string | null | undefined;
    let fromRoot = false;
    const file = FILES[kind];
    if (file) {
      text = await readSmall(join(dir, file), FILE_MAX_BYTES);
      if (text === undefined && rootDir) {
        text = await readSmall(join(rootDir, file), FILE_MAX_BYTES);
        fromRoot = text !== undefined;
      }
    } else {
      const field = kind === 'engines' || kind === 'volta' ? kind : null;
      if (!field) continue;
      let value = fieldOf(json, field);
      if (value === undefined && rootDir) {
        value = fieldOf(rootJson, field);
        fromRoot = value !== undefined;
      }
      text = value === undefined ? undefined : typeof value === 'string' ? value : null;
    }
    if (text === undefined) continue;
    const parsed = text === null ? 'invalid' : parseRequirement(kind, text);
    const shown =
      text === null
        ? null
        : (file ? (text.split(/\r?\n/)[0] ?? '') : text).trim().slice(0, VALUE_MAX);
    sources.push({
      kind,
      value: shown,
      fromRoot,
      valid: parsed !== 'invalid',
      conflict: false,
      requirement: parsed === 'invalid' ? null : parsed,
    });
  }
  const conflicts = new Set(
    conflictingSources(
      sources
        .filter((s) => s.valid)
        .map((s) => ({ kind: s.kind, range: s.requirement?.range ?? null })),
    ),
  );
  return sources.map((s) => ({ ...s, conflict: conflicts.has(s.kind) }));
}

async function version(
  platform: PlatformAdapter,
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  env?: Record<string, string>,
) {
  try {
    const { code, stdout } = await platform.execCommand(command, args, {
      cwd,
      timeoutMs,
      ...(env ? { env } : {}),
    });
    const text = stdout.trim().split(/\r?\n/).at(-1)?.trim() ?? '';
    return code === 0 && VERSION.test(text) ? text : null;
  } catch {
    return null;
  }
}

async function versionManager(platform: PlatformAdapter): Promise<VersionManager | null> {
  if (await platform.commandExists('fnm')) return 'fnm';
  if (await platform.commandExists('volta')) return 'volta';
  if (platform.id === 'win32') return (await platform.commandExists('nvm')) ? 'nvm-windows' : null;
  // nvm is a shell function on macOS: its folder in the login-shell env is the sign.
  return (await platform.resolveShellEnv())['NVM_DIR'] ? 'nvm' : null;
}

async function check(input: NodeCheckInput): Promise<NodeStatus> {
  const started = Date.now();
  const { dir, rootDir, platform } = input;
  const json = await readPackageJson(dir);
  const rootJson = rootDir ? await readPackageJson(rootDir) : null;
  const sources = await readSources(dir, rootDir, json, rootJson);
  const winner = sources.find((s) => s.valid) ?? null;
  const requirement = winner?.requirement ?? null;
  const manager = await versionManager(platform);
  const fnmFound = manager === 'fnm' || (await platform.commandExists('fnm')) === true;
  const fnmVersion = requirement?.fnmVersion ?? null;
  const fnmOn = input.fnm && fnmFound && fnmVersion !== null;

  const nodeVersion = fnmOn
    ? await version(
        platform,
        'fnm',
        ['exec', `--using=${fnmVersion}`, 'node', '--version'],
        dir,
        NODE_TIMEOUT_MS,
      )
    : await version(platform, 'node', ['--version'], dir, NODE_TIMEOUT_MS);
  const nodeOk =
    nodeVersion !== null && requirement?.range ? satisfies(nodeVersion, requirement.range) : null;

  const field = parsePackageManager(json?.['packageManager'] ?? rootJson?.['packageManager']);
  let packageManager: NodeStatus['packageManager'] = null;
  if (field) {
    const installed = await version(
      platform,
      field.name,
      ['--version'],
      dir,
      PM_TIMEOUT_MS,
      COREPACK_OFFLINE,
    );
    const sameName = input.packageManager === null || input.packageManager === field.name;
    packageManager = {
      ...field,
      detected: input.packageManager,
      installed: installed?.replace(/^v/, '') ?? null,
      ok: !sameName
        ? false
        : installed === null
          ? null
          : installed.replace(/^v/, '') === field.version,
    };
  }

  const state: NodeState =
    nodeOk === false || packageManager?.ok === false
      ? 'mismatch'
      : sources.some((s) => s.conflict)
        ? 'conflict'
        : nodeOk === null && packageManager?.ok !== true
          ? 'unknown'
          : 'ok';
  input.onChecked?.(state, Date.now() - started);
  return {
    state,
    sources: sources.map(({ requirement: _, ...view }) => view),
    requirement: winner?.kind ?? null,
    node: { version: nodeVersion, ok: nodeOk },
    packageManager,
    lockfileWarning: lockfileWarning(
      input.lockfiles,
      input.packageManager ?? detectPackageManager(new Set(input.lockfiles)) ?? 'npm',
    ),
    manager,
    fnm: { available: fnmFound && fnmVersion !== null, on: fnmOn, version: fnmVersion },
    checkedAt: Date.now(),
  };
}

function describe(status: NodeStatus, source: SourceView | undefined): string | null {
  const parts: string[] = [];
  if (status.node.ok === false && source) {
    parts.push(
      `Node ${status.node.version ?? '?'} doesn't match ${source.value ?? '?'} (${SOURCE_LABELS[source.kind]})`,
    );
  }
  const pm = status.packageManager;
  if (pm?.ok === false) {
    parts.push(
      pm.detected !== null && pm.detected !== pm.name
        ? `packageManager says ${pm.name}@${pm.version}, but the lockfile is ${pm.detected}'s`
        : `${pm.name} ${pm.installed ?? '?'} doesn't match packageManager ${pm.name}@${pm.version}`,
    );
  }
  if (status.lockfileWarning) parts.push(status.lockfileWarning);
  return parts.length > 0 ? parts.join('; ') : null;
}

export interface NodeVersionCheck {
  /** The package's status, from the 30 s cache when fresh. */
  status(input: NodeCheckInput): Promise<NodeStatus>;
  /** Drops the package's cached status and checks again. */
  refresh(input: NodeCheckInput): Promise<NodeStatus>;
  /** What a start needs: the warning, fnm's folder for PATH and a log note. */
  advice(input: NodeCheckInput): Promise<StartAdvice>;
  /** Drops every cached status (a project was removed). */
  forget(): void;
}

export function createNodeVersionCheck(): NodeVersionCheck {
  /** By package folder and fnm switch: the switch changes the check. */
  const cache = new Map<string, { at: number; status: NodeStatus }>();
  /** `fnm exec --using=<v>` → the folder holding that Node, per version, for the session. */
  const fnmBins = new Map<string, string | null>();
  const keyOf = (input: NodeCheckInput) => `${input.dir}\0${input.fnm ? 'fnm' : ''}`;

  async function status(input: NodeCheckInput): Promise<NodeStatus> {
    const hit = cache.get(keyOf(input));
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.status;
    const fresh = { at: Date.now(), status: await check(input) };
    cache.set(keyOf(input), fresh);
    return fresh.status;
  }

  async function fnmBin(input: NodeCheckInput, fnmVersion: string): Promise<string | null> {
    if (fnmBins.has(fnmVersion)) return fnmBins.get(fnmVersion) ?? null;
    let bin: string | null;
    try {
      const { code, stdout } = await input.platform.execCommand(
        'fnm',
        ['exec', `--using=${fnmVersion}`, 'node', '-p', 'process.execPath'],
        { cwd: input.dir, timeoutMs: NODE_TIMEOUT_MS },
      );
      const path = stdout.trim().split(/\r?\n/).at(-1)?.trim() ?? '';
      bin = code === 0 && path !== '' ? dirname(path) : null;
    } catch {
      bin = null;
    }
    // Only successes are remembered: a version installed later is picked up on the next start.
    if (bin !== null) fnmBins.set(fnmVersion, bin);
    return bin;
  }

  return {
    status,
    async refresh(input) {
      cache.delete(`${input.dir}\0`);
      cache.delete(`${input.dir}\0fnm`);
      return status(input);
    },
    async advice(input) {
      const current = await status(input);
      const source = current.sources.find((s) => s.kind === current.requirement);
      if (current.fnm.on && current.fnm.version !== null) {
        const bin = await fnmBin(input, current.fnm.version);
        if (bin === null) {
          const wanted = current.fnm.version;
          return {
            warning: `Node isn't ${source?.value ?? wanted} (${source ? SOURCE_LABELS[source.kind] : 'required'}): fnm couldn't provide it`,
            pathPrepend: null,
            note: `▲ fnm couldn't provide Node ${wanted} (is it installed? fnm install ${wanted})`,
          };
        }
        return {
          warning: describe(current, source),
          pathPrepend: bin,
          note: `▸ fnm: Node ${current.fnm.version} from ${bin}`,
        };
      }
      return { warning: describe(current, source), pathPrepend: null, note: null };
    },
    forget() {
      cache.clear();
    },
  };
}

/** The app's one check: the Node tool and the Node module share its cache. */
export const nodeVersionCheck = createNodeVersionCheck();
