// Health checks: each package's checks run while one of its scripts runs. Env-key checks read the value in
// main and use only its origin; results, logs and labels never carry an env value.
import { randomUUID } from 'node:crypto';
import { NestboxError } from '@shared/errors';
import type { DetectedProject } from '@shared/detected';
import { belongsTo, isLive, type ProcessSummary } from '@shared/processes';
import {
  CheckInputSchema,
  type CheckResult,
  type CheckView,
  healthContract,
  healthDefinition,
  type HealthSettings,
  MAX_CHECKS,
  type PackageSettings,
  type StoredCheck,
  UrlKeySchema,
} from '@shared/tools/health/contract';
import type { Logger } from '../../logger';
import type { ProcessEvent } from '../../processes/process-manager';
import { entries, parseEnv } from '../env/dotenv';
import type { EnvFileAccess } from '../env/env-files';
import { type AnyMainTool, defineMainTool, type ToolContext } from '../types';
import type { CheckOptions } from './check';
import { createHealthScheduler } from './scheduler';
import { envCheckUrl } from './url';

export interface HealthToolDeps {
  processes: { list(): ProcessSummary[]; on(listener: (event: ProcessEvent) => void): () => void };
  /** A package (root or workspace) by id; null once it is gone. */
  getDetected(projectId: string): DetectedProject | null;
  /** The root project's health settings, parsed (every field defaulted). */
  readSettings(rootId: string): HealthSettings;
  envFiles: Pick<EnvFileAccess, 'read'>;
  check(url: string, opts: CheckOptions): Promise<CheckResult>;
  emit(projectId: string, event: 'changed'): void;
  notify(notice: { projectId: string; title: string; body: string }): void;
  logger: Logger;
}

type Ctx = ToolContext<HealthSettings>;

/** At most 4 `changed` events per second per package. */
const EMIT_GAP_MS = 250;
const WORKSPACE_SEPARATOR = '::';
const EXCLUDED_KEYS = new Set(['DATABASE_URL']);

const defaultPackage = (): PackageSettings => ({ checks: [], intervalSec: 30 });

export function createHealthTool(deps: HealthToolDeps): AnyMainTool {
  /** By package id, then check id: the last result of each check, in memory only. */
  const results = new Map<string, Map<string, CheckResult>>();
  /** By package id, then check id: the state seen this live session (notify only after an ok). */
  const seen = new Map<string, Map<string, CheckResult['state']>>();
  const emitTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const lastEmit = new Map<string, number>();
  const live = new Set<string>();
  /** By package id: bumped on every live change, so a run that outlasts one doesn't touch the new session. */
  const sessions = new Map<string, number>();
  const nextSession = (id: string) => sessions.set(id, (sessions.get(id) ?? 0) + 1);

  const packageOf = (project: DetectedProject): PackageSettings =>
    deps.readSettings(project.rootId).packages[project.relPath] ?? defaultPackage();

  function changed(projectId: string): void {
    if (emitTimers.has(projectId)) return;
    const wait = (lastEmit.get(projectId) ?? -Infinity) + EMIT_GAP_MS - Date.now();
    const fire = () => {
      emitTimers.delete(projectId);
      lastEmit.set(projectId, Date.now());
      deps.emit(projectId, 'changed');
    };
    if (wait <= 0) return fire();
    const timer = setTimeout(fire, wait);
    timer.unref?.();
    emitTimers.set(projectId, timer);
  }

  async function readEnv(dir: string): Promise<Map<string, string>> {
    const text = await deps.envFiles
      .read(dir, '.env')
      .then((r) => r.text)
      .catch(() => null);
    return text === null ? new Map() : entries(parseEnv(text));
  }

  function label(check: StoredCheck, env: Map<string, string>): string {
    if (check.kind === 'url') return check.url;
    const resolved = envCheckUrl(env.get(check.key), check.path);
    return resolved.ok
      ? `${check.key} · ${resolved.host}${check.path}`
      : `${check.key} · ${check.path}`;
  }

  async function run(projectId: string): Promise<void> {
    const project = deps.getDetected(projectId);
    if (!project) return;
    const { checks } = packageOf(project);
    if (checks.length === 0) return;
    const session = sessions.get(projectId) ?? 0;
    // Read only when an env check needs it, so URL checks start at once.
    let envRead: Promise<Map<string, string>> | null = null;
    const readOnce = () => (envRead ??= readEnv(project.path));
    const outcomes = await Promise.all(
      checks.map(async (check): Promise<[StoredCheck, CheckResult]> => {
        const opts = check.expect === undefined ? {} : { expect: check.expect };
        if (check.kind === 'url') return [check, await deps.check(check.url, opts)];
        const resolved = envCheckUrl((await readOnce()).get(check.key), check.path);
        if (!resolved.ok)
          return [
            check,
            { state: 'config', status: null, ms: null, reason: resolved.reason, at: Date.now() },
          ];
        return [check, await deps.check(resolved.url, opts)];
      }),
    );

    const stored = results.get(projectId) ?? new Map<string, CheckResult>();
    if ((sessions.get(projectId) ?? 0) !== session) {
      // The script stopped or restarted meanwhile: keep the results, but neither notify nor remember them.
      const idle = !live.has(projectId);
      for (const [check, result] of outcomes)
        stored.set(check.id, idle ? { ...result, state: 'idle' } : result);
      results.set(projectId, stored);
      changed(projectId);
      return;
    }
    const states = seen.get(projectId) ?? new Map<string, CheckResult['state']>();
    const { notify } = deps.readSettings(project.rootId);
    const env = envRead ? await envRead : new Map<string, string>();
    for (const [check, result] of outcomes) {
      const before = states.get(check.id);
      if (before !== result.state) {
        deps.logger.info('health check', {
          projectId,
          checkId: check.id,
          state: result.state,
          code: result.reason ?? 'none',
        });
      }
      if (before === 'ok' && result.state === 'fail' && notify) {
        deps.notify({
          projectId,
          title: `${project.name} health check failed`,
          body: `${label(check, env)}: ${result.reason ?? 'failed'}`,
        });
      }
      states.set(check.id, result.state);
      stored.set(check.id, result);
    }
    results.set(projectId, stored);
    seen.set(projectId, states);
    changed(projectId);
  }

  const scheduler = createHealthScheduler({
    run,
    interval: (projectId) => {
      const project = deps.getDetected(projectId);
      return project ? packageOf(project).intervalSec : 30;
    },
  });

  function goIdle(projectId: string): void {
    seen.delete(projectId);
    const stored = results.get(projectId);
    if (stored) for (const [id, r] of stored) stored.set(id, { ...r, state: 'idle' });
  }

  function syncLive(): void {
    const now = new Set<string>();
    for (const summary of deps.processes.list()) {
      if (!isLive(summary.state)) continue;
      now.add(summary.projectId);
      // A root counts its workspace packages' scripts too.
      const rootId = summary.projectId.split(WORKSPACE_SEPARATOR)[0];
      if (rootId) now.add(rootId);
    }
    for (const id of [...live]) {
      if (now.has(id)) continue;
      live.delete(id);
      nextSession(id);
      scheduler.setLive(id, false);
      goIdle(id);
      changed(id);
    }
    for (const id of now) {
      if (live.has(id)) continue;
      live.add(id);
      nextSession(id);
      scheduler.setLive(id, true);
      changed(id);
    }
  }

  const unsubscribe = deps.processes.on((event) => {
    if (event.type === 'changed') syncLive();
  });
  syncLive();

  function forget(predicate: (id: string) => boolean): void {
    for (const id of [...live]) {
      if (!predicate(id)) continue;
      live.delete(id);
      scheduler.setLive(id, false);
    }
    for (const map of [results, seen, lastEmit, sessions])
      for (const id of [...map.keys()]) if (predicate(id)) map.delete(id);
    for (const [id, timer] of [...emitTimers]) {
      if (!predicate(id)) continue;
      clearTimeout(timer);
      emitTimers.delete(id);
    }
  }

  const updatePackage = (ctx: Ctx, fn: (p: PackageSettings) => PackageSettings) =>
    ctx.settings.update((s) => ({
      ...s,
      packages: {
        ...s.packages,
        [ctx.project.relPath]: fn(s.packages[ctx.project.relPath] ?? defaultPackage()),
      },
    }));

  return defineMainTool({
    ...healthDefinition,
    contract: healthContract,
    handlers: {
      async status(ctx: Ctx) {
        const settings = ctx.settings.get();
        const pkg = settings.packages[ctx.project.relPath] ?? defaultPackage();
        const env = await readEnv(ctx.project.path);
        const stored = results.get(ctx.project.id);
        const checks: CheckView[] = pkg.checks.map((check) => ({
          id: check.id,
          kind: check.kind,
          label: label(check, env),
          expect: check.expect ?? null,
          result: stored?.get(check.id) ?? null,
        }));
        const portText = env.get('PORT')?.trim() ?? '';
        const portNumber = /^\d{1,5}$/.test(portText) ? Number(portText) : NaN;
        const port = portNumber >= 1 && portNumber <= 65535 ? portNumber : null;
        const portTaken =
          port !== null &&
          pkg.checks.some(
            (c) =>
              c.kind === 'url' &&
              new URL(c.url).port === String(port) &&
              /^(localhost|127\.0\.0\.1)$/.test(new URL(c.url).hostname),
          );
        const used = new Set(pkg.checks.flatMap((c) => (c.kind === 'env' ? [c.key] : [])));
        const envKeys = [...env.keys()]
          .filter((k) => UrlKeySchema.safeParse(k).success && !EXCLUDED_KEYS.has(k) && !used.has(k))
          .sort();
        return {
          live: live.has(ctx.project.id),
          intervalSec: pkg.intervalSec,
          notify: settings.notify,
          checks,
          suggestions: { port: portTaken ? null : port, envKeys },
        };
      },

      async addCheck(ctx: Ctx, { check }) {
        const parsed = CheckInputSchema.parse(check);
        const current = ctx.settings.get().packages[ctx.project.relPath]?.checks.length ?? 0;
        if (current >= MAX_CHECKS)
          throw new NestboxError('VALIDATION', `At most ${MAX_CHECKS} checks per package`);
        updatePackage(ctx, (p) => ({
          ...p,
          checks: [...p.checks, { ...parsed, id: randomUUID() }],
        }));
        changed(ctx.project.id);
      },

      async removeCheck(ctx: Ctx, { id }) {
        updatePackage(ctx, (p) => ({ ...p, checks: p.checks.filter((c) => c.id !== id) }));
        results.get(ctx.project.id)?.delete(id);
        seen.get(ctx.project.id)?.delete(id);
        changed(ctx.project.id);
      },

      async setOptions(ctx: Ctx, { intervalSec, notify }) {
        if (intervalSec !== undefined) updatePackage(ctx, (p) => ({ ...p, intervalSec }));
        if (notify !== undefined) ctx.settings.update((s) => ({ ...s, notify }));
        changed(ctx.project.id);
      },

      async checkNow(ctx: Ctx) {
        await scheduler.checkNow(ctx.project.id);
      },
    },
    async dispose() {
      unsubscribe();
      scheduler.dispose();
      for (const timer of emitTimers.values()) clearTimeout(timer);
      emitTimers.clear();
    },
    forgetProject(rootId) {
      forget((id) => belongsTo(id, rootId));
    },
  });
}
