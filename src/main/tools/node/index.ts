// The Node tool: which Node version a package needs (version files, engines, Volta), whether the sources agree,
// and whether the Node and package manager that will run its scripts match. Read-only, no network: Corepack
// runs offline. With fnm, scripts can run on the required version (the scripts tool asks `startAdvice`).
import { open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DetectedProject } from '@shared/detected';
import { belongsTo } from '@shared/processes';
import {
  nodeContract,
  nodeDefinition,
  type NodeSettings,
  type NodeState,
  type NodeStatus,
  SOURCE_KINDS,
  SOURCE_LABELS,
  type SourceKind,
  type SourceView,
  type StartAdvice,
  type VersionManager,
} from '@shared/tools/node/contract';
import type { Logger } from '../../logger';
import type { PlatformAdapter } from '../../platform/adapter';
import { type AnyMainTool, defineMainTool, type ToolContext } from '../types';
import { conflictingSources, parsePackageManager, parseRequirement, type Requirement, satisfies } from './versions';

export interface NodeToolDeps {
  logger: Logger;
  /** Throws NOT_FOUND for unknown ids (the root project, for inherited sources). */
  getDetected(projectId: string): DetectedProject;
}

type Ctx = ToolContext<NodeSettings>;

const CACHE_MS = 30_000;
const FILE_MAX_BYTES = 1024;
const PACKAGE_JSON_MAX_BYTES = 1024 * 1024;
const VALUE_MAX = 100;
const NODE_TIMEOUT_MS = 10_000;
const PM_TIMEOUT_MS = 15_000;
/** Corepack must never download a package manager just because NestBox asked for its version. */
const COREPACK_OFFLINE = { COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' };
const VERSION = /^v?\d+\.\d+\.\d+\S*$/;

interface Source extends SourceView {
  requirement: Requirement | null;
}

/** A small text file's contents; null when it is too big or unreadable; undefined when it isn't there. */
async function readSmall(path: string, max = FILE_MAX_BYTES): Promise<string | null | undefined> {
  let handle;
  try {
    handle = await open(path, 'r');
  } catch {
    return undefined;
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) return undefined;
    if (stats.size > max) return null;
    return await handle.readFile('utf8');
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

const FILES: Partial<Record<SourceKind, string>> = { nvmrc: '.nvmrc', 'node-version': '.node-version' };

/** package.json as an object (detection keeps only name and scripts); null when missing or unreadable. */
async function readPackageJson(dir: string): Promise<Record<string, unknown> | null> {
  const text = await readSmall(join(dir, 'package.json'), PACKAGE_JSON_MAX_BYTES);
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function fieldOf(json: Record<string, unknown> | null, kind: 'engines' | 'volta'): unknown {
  const holder = json?.[kind];
  return holder && typeof holder === 'object' ? (holder as Record<string, unknown>)['node'] : undefined;
}

export function createNodeTool(deps: NodeToolDeps): AnyMainTool {
  const cache = new Map<string, { at: number; status: NodeStatus; requirement: Requirement | null }>();
  /** `fnm exec --using=<v>` → the folder holding that Node, per version, for the session. */
  const fnmBins = new Map<string, string | null>();

  function rootOf(project: DetectedProject): DetectedProject | null {
    if (project.relPath === '') return null;
    try {
      return deps.getDetected(project.rootId);
    } catch {
      return null;
    }
  }

  async function readSources(
    project: DetectedProject,
    root: DetectedProject | null,
    json: Record<string, unknown> | null,
    rootJson: Record<string, unknown> | null,
  ): Promise<Source[]> {
    const sources: Source[] = [];
    for (const kind of SOURCE_KINDS) {
      let text: string | null | undefined;
      let fromRoot = false;
      const file = FILES[kind];
      if (file) {
        text = await readSmall(join(project.path, file));
        if (text === undefined && root) {
          text = await readSmall(join(root.path, file));
          fromRoot = text !== undefined;
        }
      } else {
        const field = kind === 'engines' || kind === 'volta' ? kind : null;
        if (!field) continue;
        let value = fieldOf(json, field);
        if (value === undefined && root) {
          value = fieldOf(rootJson, field);
          fromRoot = value !== undefined;
        }
        text = value === undefined ? undefined : typeof value === 'string' ? value : null;
      }
      if (text === undefined) continue;
      const parsed = text === null ? 'invalid' : parseRequirement(kind, text);
      const shown = text === null ? null : (file ? (text.split(/\r?\n/)[0] ?? '') : text).trim().slice(0, VALUE_MAX);
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
      conflictingSources(sources.filter((s) => s.valid).map((s) => ({ kind: s.kind, range: s.requirement?.range ?? null }))),
    );
    return sources.map((s) => ({ ...s, conflict: conflicts.has(s.kind) }));
  }

  async function version(platform: PlatformAdapter, command: string, args: string[], cwd: string, timeoutMs: number, env?: Record<string, string>) {
    try {
      const { code, stdout } = await platform.execCommand(command, args, { cwd, timeoutMs, ...(env ? { env } : {}) });
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

  async function check(ctx: Ctx): Promise<{ status: NodeStatus; requirement: Requirement | null }> {
    const started = Date.now();
    const { project, platform } = ctx;
    const root = rootOf(project);
    const json = await readPackageJson(project.path);
    const rootJson = root ? await readPackageJson(root.path) : null;
    const sources = await readSources(project, root, json, rootJson);
    const winner = sources.find((s) => s.valid) ?? null;
    const requirement = winner?.requirement ?? null;
    const manager = await versionManager(platform);
    const fnmFound = manager === 'fnm' || (await platform.commandExists('fnm')) === true;
    const fnmVersion = requirement?.fnmVersion ?? null;
    const fnmOn = ctx.settings.get().fnm && fnmFound && fnmVersion !== null;

    const nodeVersion = fnmOn
      ? await version(platform, 'fnm', ['exec', `--using=${fnmVersion}`, 'node', '--version'], project.path, NODE_TIMEOUT_MS)
      : await version(platform, 'node', ['--version'], project.path, NODE_TIMEOUT_MS);
    const nodeOk = nodeVersion !== null && requirement?.range ? satisfies(nodeVersion, requirement.range) : null;

    const field = parsePackageManager(json?.['packageManager'] ?? rootJson?.['packageManager']);
    let packageManager: NodeStatus['packageManager'] = null;
    if (field) {
      const installed = await version(platform, field.name, ['--version'], project.path, PM_TIMEOUT_MS, COREPACK_OFFLINE);
      const sameName = project.packageManager === null || project.packageManager === field.name;
      packageManager = {
        ...field,
        detected: project.packageManager,
        installed: installed?.replace(/^v/, '') ?? null,
        ok: !sameName ? false : installed === null ? null : installed.replace(/^v/, '') === field.version,
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
    deps.logger.info('node check', { projectId: project.id, state, ms: Date.now() - started });
    return {
      requirement,
      status: {
        state,
        sources: sources.map(({ requirement: _, ...view }) => view),
        requirement: winner?.kind ?? null,
        node: { version: nodeVersion, ok: nodeOk },
        packageManager,
        manager,
        fnm: { available: fnmFound && fnmVersion !== null, on: fnmOn, version: fnmVersion },
        checkedAt: Date.now(),
      },
    };
  }

  async function cached(ctx: Ctx) {
    const hit = cache.get(ctx.project.id);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit;
    const fresh = { at: Date.now(), ...(await check(ctx)) };
    cache.set(ctx.project.id, fresh);
    return fresh;
  }

  async function fnmBin(ctx: Ctx, fnmVersion: string): Promise<string | null> {
    if (fnmBins.has(fnmVersion)) return fnmBins.get(fnmVersion) ?? null;
    let bin: string | null;
    try {
      const { code, stdout } = await ctx.platform.execCommand(
        'fnm',
        ['exec', `--using=${fnmVersion}`, 'node', '-p', 'process.execPath'],
        { cwd: ctx.project.path, timeoutMs: NODE_TIMEOUT_MS },
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

  function describe(status: NodeStatus, source: SourceView | undefined): string | null {
    const parts: string[] = [];
    if (status.node.ok === false && source) {
      parts.push(`Node ${status.node.version ?? '?'} doesn't match ${source.value ?? '?'} (${SOURCE_LABELS[source.kind]})`);
    }
    const pm = status.packageManager;
    if (pm?.ok === false) {
      parts.push(
        pm.detected !== null && pm.detected !== pm.name
          ? `packageManager says ${pm.name}@${pm.version}, but the lockfile is ${pm.detected}'s`
          : `${pm.name} ${pm.installed ?? '?'} doesn't match packageManager ${pm.name}@${pm.version}`,
      );
    }
    return parts.length > 0 ? parts.join('; ') : null;
  }

  return defineMainTool({
    ...nodeDefinition,
    contract: nodeContract,
    handlers: {
      status: async (ctx: Ctx) => (await cached(ctx)).status,
      refresh: async (ctx: Ctx) => {
        cache.delete(ctx.project.id);
        return (await cached(ctx)).status;
      },
      setFnm: async (ctx: Ctx, { enabled }) => {
        ctx.settings.update((s) => ({ ...s, fnm: enabled }));
        // The switch belongs to the root project, so every package's check changes.
        for (const id of [...cache.keys()]) if (belongsTo(id, ctx.project.rootId)) cache.delete(id);
        return (await cached(ctx)).status;
      },
      startAdvice: async (ctx: Ctx): Promise<StartAdvice> => {
        const { status } = await cached(ctx);
        const source = status.sources.find((s) => s.kind === status.requirement);
        if (status.fnm.on && status.fnm.version !== null) {
          const bin = await fnmBin(ctx, status.fnm.version);
          if (bin === null) {
            const wanted = status.fnm.version;
            return {
              warning: `Node isn't ${source?.value ?? wanted} (${source ? SOURCE_LABELS[source.kind] : 'required'}): fnm couldn't provide it`,
              pathPrepend: null,
              note: `▲ fnm couldn't provide Node ${wanted} (is it installed? fnm install ${wanted})`,
            };
          }
          return { warning: describe(status, source), pathPrepend: bin, note: `▸ fnm: Node ${status.fnm.version} from ${bin}` };
        }
        return { warning: describe(status, source), pathPrepend: null, note: null };
      },
    },
    forgetProject(rootId) {
      for (const id of [...cache.keys()]) if (belongsTo(id, rootId)) cache.delete(id);
    },
  });
}
