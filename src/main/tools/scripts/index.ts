import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type DetectedProject, workspaceId } from '@shared/detected';
import { NestboxError } from '@shared/errors';
import { isLive, type LogLine, type ProcessState, type ProcessSummary } from '@shared/processes';
import {
  type ComposeStep,
  scriptsContract,
  scriptsDefinition,
  type ScriptsSettings,
  type SkippedEntry,
} from '@shared/tools/scripts/contract';
import type { RunGroup, RunGroupCompose, RunGroupEntry } from '@shared/types';
import type { Logger } from '../../logger';
import type { ProcessManager, StartRequest } from '../../processes/process-manager';
import type { SharedContext } from '../shared-context';
import { type AnyMainTool, defineMainTool, type ToolContext } from '../types';
import { exportFileName, formatExport } from './export';
import { createLogBatcher } from './log-batcher';

export interface ScriptsToolDeps {
  processes: ProcessManager;
  runGroups: {
    get(rootId: string): RunGroup[];
    set(rootId: string, groups: RunGroup[]): RunGroup[];
  };
  /** Throws NOT_FOUND for unknown ids (used to resolve run-group entries in other packages). */
  getDetected(projectId: string): DetectedProject;
  shared: SharedContext;
  saveFile(defaultName: string): Promise<string | null>;
  writeFile(path: string, text: string): Promise<void>;
  isFile(path: string): Promise<boolean>;
  emit(projectId: string, event: 'logs', payload: { script: string; lines: LogLine[] }): void;
  logger: Logger;
  /** The Compose tool's actions for a package (services empty = the whole stack). */
  compose: {
    up(projectId: string, services: string[], opts: { wait: boolean }): Promise<{ ok: boolean }>;
    stop(projectId: string, services: string[]): Promise<{ ok: boolean }>;
  };
}

/** The shared-context fact the scripts tool publishes per project (read by the M2 port manager). */
export const PROCESSES_FACT = 'scripts.processes';

type Ctx = ToolContext<ScriptsSettings>;

export function createScriptsTool(deps: ScriptsToolDeps): AnyMainTool {
  const batcher = createLogBatcher({
    intervalMs: 50,
    flush: (projectId, script, lines) => deps.emit(projectId, 'logs', { script, lines }),
  });

  deps.processes.on((event) => {
    if (event.type === 'line') batcher.add(event.projectId, event.script, event.line);
    if (event.type === 'changed') publishFacts();
  });

  /** Projects with a published fact, so one whose processes are all forgotten gets an empty list. */
  let published = new Set<string>();

  function publishFacts(): void {
    const byProject = new Map<string, { script: string; pid: number | null; state: ProcessState }[]>();
    for (const p of deps.processes.list()) {
      const facts = byProject.get(p.projectId) ?? [];
      facts.push({ script: p.script, pid: p.pid, state: p.state });
      byProject.set(p.projectId, facts);
    }
    for (const projectId of published) {
      if (!byProject.has(projectId)) deps.shared.forProject(projectId).publish(PROCESSES_FACT, []);
    }
    for (const [projectId, facts] of byProject) deps.shared.forProject(projectId).publish(PROCESSES_FACT, facts);
    published = new Set(byProject.keys());
  }

  const hasScript = (project: DetectedProject, script: string): boolean =>
    Object.hasOwn(project.packageJson?.scripts ?? {}, script);

  function requireScript(project: DetectedProject, script: string): void {
    if (!hasScript(project, script)) throw new NestboxError('NOT_FOUND', 'Unknown script');
  }

  const isAuto = (settings: ScriptsSettings, project: DetectedProject, script: string): boolean =>
    settings.autoRestart.some((e) => e.relPath === project.relPath && e.script === script);

  const requestFor = (project: DetectedProject, script: string, autoRestart: boolean): StartRequest => ({
    projectId: project.id,
    script,
    cwd: project.path,
    packageManager: project.packageManager,
    autoRestart,
  });

  function requireRoot(project: DetectedProject): void {
    if (project.relPath !== '') throw new NestboxError('VALIDATION', 'Run groups belong to the root project');
  }

  function findGroup(project: DetectedProject, name: string): RunGroup {
    const group = deps.runGroups.get(project.rootId).find((g) => g.name === name);
    if (!group) throw new NestboxError('NOT_FOUND', 'Unknown run group');
    return group;
  }

  /** The package an entry names, or null when it no longer exists or lacks the script. */
  function resolveEntry(rootId: string, entry: RunGroupEntry): DetectedProject | null {
    const id = entry.relPath === '' ? rootId : workspaceId(rootId, entry.relPath);
    try {
      const project = deps.getDetected(id);
      return hasScript(project, entry.script) ? project : null;
    } catch {
      return null;
    }
  }

  /** The package a compose entry names, or null when it is gone or has no compose file. */
  function resolveCompose(rootId: string, entry: RunGroupCompose): DetectedProject | null {
    const id = entry.relPath === '' ? rootId : workspaceId(rootId, entry.relPath);
    try {
      const project = deps.getDetected(id);
      return project.dockerCompose === null ? null : project;
    } catch {
      return null;
    }
  }

  /** Brings a group's compose services up and waits for them; a failure never stops the scripts. */
  async function composeUp(rootId: string, entry: RunGroupCompose): Promise<ComposeStep> {
    const project = resolveCompose(rootId, entry);
    if (!project) return { relPath: entry.relPath, result: 'missing' };
    try {
      const { ok } = await deps.compose.up(project.id, entry.services, { wait: true });
      if (!ok) deps.logger.warn('run group compose failed', { projectId: project.id });
      return { relPath: entry.relPath, result: ok ? 'ok' : 'failed' };
    } catch (error) {
      const code = error instanceof NestboxError ? error.code : 'unknown';
      deps.logger.warn('run group compose failed', { projectId: project.id, code });
      return { relPath: entry.relPath, result: code === 'CONFLICT' ? 'busy' : code === 'NOT_FOUND' ? 'missing' : 'failed' };
    }
  }

  /**
   * Candidate files for a path taken from log text, most likely first: file: URLs, paths relative to
   * the project, and rooted paths, which Vite prints relative to the project but which are absolute on POSIX.
   */
  function candidatePaths(project: DetectedProject, raw: string): string[] {
    if (raw.startsWith('file:')) {
      try {
        return [fileURLToPath(raw)];
      } catch {
        return [];
      }
    }
    if (/^[\\/](?![\\/])/.test(raw)) return [resolve(project.path, `.${raw}`), resolve(raw)];
    return [isAbsolute(raw) ? raw : resolve(project.path, raw)];
  }

  return defineMainTool({
    ...scriptsDefinition,
    contract: scriptsContract,

    async dispose() {
      batcher.flushNow();
      batcher.dispose();
    },

    handlers: {
      list: async (ctx: Ctx) => {
        const settings = ctx.settings.get();
        const scripts = Object.entries(ctx.project.packageJson?.scripts ?? {}).map(([name, command]) => ({
          name,
          command,
          autoRestart: isAuto(settings, ctx.project, name),
        }));
        if (ctx.project.relPath !== '') return { scripts, runGroups: null, packages: null };
        const packages = [ctx.project, ...ctx.project.workspaces].map((p) => ({
          relPath: p.relPath,
          name: p.name,
          scripts: Object.keys(p.packageJson?.scripts ?? {}),
        }));
        return { scripts, runGroups: deps.runGroups.get(ctx.project.rootId), packages };
      },

      start: async (ctx: Ctx, { script }) => {
        requireScript(ctx.project, script);
        return deps.processes.start(requestFor(ctx.project, script, isAuto(ctx.settings.get(), ctx.project, script)));
      },

      stop: async (ctx: Ctx, { script }) => deps.processes.stop(ctx.project.id, script),

      restart: async (ctx: Ctx, { script }) => {
        requireScript(ctx.project, script);
        return deps.processes.restart(requestFor(ctx.project, script, isAuto(ctx.settings.get(), ctx.project, script)));
      },

      setAutoRestart: async (ctx: Ctx, { script, enabled }) => {
        requireScript(ctx.project, script);
        const { relPath } = ctx.project;
        ctx.settings.update((s) => ({
          autoRestart: [
            ...s.autoRestart.filter((e) => !(e.relPath === relPath && e.script === script)),
            ...(enabled ? [{ relPath, script }] : []),
          ],
        }));
        deps.processes.setAutoRestart(ctx.project.id, script, enabled);
        return { enabled };
      },

      getLogs: async (ctx: Ctx, { script, afterSeq }) => deps.processes.logs(ctx.project.id, script, afterSeq),

      clearLogs: async (ctx: Ctx, { script }) => {
        deps.processes.clearLogs(ctx.project.id, script);
      },

      exportLogs: async (ctx: Ctx, { script, seqs }) => {
        const all = deps.processes.logs(ctx.project.id, script).lines;
        const wanted = seqs === 'all' ? null : new Set(seqs);
        const lines = wanted ? all.filter((l) => wanted.has(l.seq)) : all;
        const path = await deps.saveFile(exportFileName(script, new Date()));
        if (path === null) return { saved: false };
        await deps.writeFile(path, formatExport(lines));
        return { saved: true };
      },

      openFileAt: async (ctx: Ctx, { path, line }) => {
        for (const file of candidatePaths(ctx.project, path)) {
          if (await deps.isFile(file)) {
            await ctx.platform.openInEditor(file, line);
            return;
          }
        }
        throw new NestboxError('NOT_FOUND', 'File not found');
      },

      saveRunGroup: async (ctx: Ctx, { previousName, group }) => {
        requireRoot(ctx.project);
        const groups = deps.runGroups.get(ctx.project.rootId);
        const replacing = previousName ?? group.name;
        if (previousName !== undefined && !groups.some((g) => g.name === previousName)) {
          throw new NestboxError('NOT_FOUND', 'Unknown run group');
        }
        if (groups.some((g) => g.name === group.name && g.name !== replacing)) {
          throw new NestboxError('CONFLICT', 'A run group with this name already exists');
        }
        const exists = groups.some((g) => g.name === replacing);
        const next = exists ? groups.map((g) => (g.name === replacing ? group : g)) : [...groups, group];
        return deps.runGroups.set(ctx.project.rootId, next);
      },

      deleteRunGroup: async (ctx: Ctx, { name }) => {
        requireRoot(ctx.project);
        findGroup(ctx.project, name);
        return deps.runGroups.set(
          ctx.project.rootId,
          deps.runGroups.get(ctx.project.rootId).filter((g) => g.name !== name),
        );
      },

      startRunGroup: async (ctx: Ctx, { name }) => {
        const group = findGroup(ctx.project, name);
        // Services first, so a database is accepting connections before the API starts.
        const compose = await Promise.all(group.compose.map((entry) => composeUp(ctx.project.rootId, entry)));
        const settings = ctx.settings.get();
        const skipped: SkippedEntry[] = [];
        const started: ProcessSummary[] = [];
        const results = await Promise.allSettled(
          group.entries.map(async (entry) => {
            const project = resolveEntry(ctx.project.rootId, entry);
            if (!project) {
              skipped.push({ ...entry, reason: 'missing' });
              return;
            }
            try {
              started.push(
                await deps.processes.start(requestFor(project, entry.script, isAuto(settings, project, entry.script))),
              );
            } catch (error) {
              if (error instanceof NestboxError && error.code === 'CONFLICT') {
                skipped.push({ ...entry, reason: 'running' });
                return;
              }
              throw error;
            }
          }),
        );
        const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (failure) throw failure.reason;
        return { started, skipped, compose };
      },

      stopRunGroup: async (ctx: Ctx, { name }) => {
        const group = findGroup(ctx.project, name);
        const ids = new Set(
          group.entries.map((e) => JSON.stringify([e.relPath === '' ? ctx.project.rootId : workspaceId(ctx.project.rootId, e.relPath), e.script])),
        );
        // Live members, and crashed ones waiting out an auto-restart backoff (or they would come back).
        const targets = deps.processes
          .list()
          .filter(
            (p) => (isLive(p.state) || p.nextRestartAt !== null) && ids.has(JSON.stringify([p.projectId, p.script])),
          );
        const services = group.compose.flatMap((entry) => {
          const project = resolveCompose(ctx.project.rootId, entry);
          return project ? [{ project, entry }] : [];
        });
        await Promise.allSettled([
          ...targets.map((p) => deps.processes.stop(p.projectId, p.script)),
          // `stop`, never `down`: containers and volumes stay.
          ...services.map(({ project, entry }) =>
            deps.compose.stop(project.id, entry.services).catch((error: unknown) => {
              deps.logger.warn('run group compose stop failed', {
                projectId: project.id,
                code: error instanceof NestboxError ? error.code : 'unknown',
              });
            }),
          ),
        ]);
      },
    },
  });
}
