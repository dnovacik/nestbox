import type { ChildProcess } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { NestboxError } from '@shared/errors';
import { belongsTo, type LogLine } from '@shared/processes';
import { databaseContract, databaseDefinition, type DbStatus, type PrismaCommand } from '@shared/tools/database/contract';
import type { Logger } from '../../logger';
import { LineSplitter } from '../../processes/line-splitter';
import { BatchedLog } from '../batched-log';
import type { EnvFileAccess } from '../env/env-files';
import { type AnyMainTool, defineMainTool, type ToolContext } from '../types';
import { firstPrismaCode, loginMessage, prismaCommand } from './prisma';
import type { checkReachable as CheckReachable } from './reach';
import { readDatasource } from './schema';
import { findUrl } from './source';
import { describeUrl } from './url';

export interface DatabaseToolDeps {
  envFiles: Pick<EnvFileAccess, 'read'>;
  checkReachable: typeof CheckReachable;
  firstFreePort(start: number, host: string): Promise<number | null>;
  logger: Logger;
}

type Ctx = ToolContext<Record<string, never>>;

const LOG_LINES = 2_000;
const LOGIN_TIMEOUT_MS = 20_000;
const STUDIO_PORT = 5555;
const CONFIG_FILES = ['prisma.config.ts', 'prisma.config.mts', 'prisma.config.js', 'prisma.config.mjs'];
const COMMAND_ARGS: Record<PrismaCommand, string[]> = { 'migrate-status': ['migrate', 'status'], generate: ['generate'] };

interface Run {
  child: ChildProcess;
  stopping: boolean;
  killTree(pid: number): Promise<void>;
}

interface State {
  command: { kind: PrismaCommand | 'test-login'; run: Run } | null;
  studio: { port: number; run: Run } | null;
  logs: BatchedLog;
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null)) !== null;
}

/** Whether `prisma` resolves from dir the way Node finds packages: node_modules here or in a parent (a workspace root). */
export async function prismaInstalled(dir: string): Promise<boolean> {
  for (let current = dir; ; ) {
    if (await exists(join(current, 'node_modules', 'prisma', 'package.json'))) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

const NOT_INSTALLED = "Prisma isn't installed in this package";

async function stopRun(run: Run | undefined): Promise<void> {
  if (!run || run.stopping) return;
  run.stopping = true;
  if (run.child.pid !== undefined) await run.killTree(run.child.pid).catch(() => undefined);
}

export function createDatabaseTool(deps: DatabaseToolDeps): AnyMainTool {
  /** By project id (root or workspace package). */
  const states = new Map<string, State>();

  function stateOf(ctx: Ctx): State {
    const emit = (lines: LogLine[]) => ctx.emit('logs', { lines });
    const existing = states.get(ctx.project.id);
    if (existing) {
      existing.logs.emit = emit;
      return existing;
    }
    const created: State = { command: null, studio: null, logs: new BatchedLog(LOG_LINES, emit) };
    states.set(ctx.project.id, created);
    return created;
  }

  function schemaOf(ctx: Ctx): string {
    const schema = ctx.project.prismaSchema;
    if (schema === null) throw new NestboxError('NOT_FOUND', 'This package has no Prisma schema');
    return schema;
  }

  /** The URL's description and where it came from; the raw value is dropped before this returns. */
  async function target(ctx: Ctx) {
    const dir = ctx.project.path;
    const schema = ctx.project.prismaSchema;
    const schemaPath = schema === null ? null : join(dir, ...schema.split('/'));
    const datasource = schemaPath === null ? null : await readDatasource(schemaPath);
    const variable = datasource?.env ?? 'DATABASE_URL';
    // Prisma resolves file: URLs from the schema's folder.
    const schemaDir = schemaPath === null ? dir : schema?.endsWith('.prisma') ? dirname(schemaPath) : schemaPath;
    if (datasource?.literal) return { variable, datasource, found: null, literal: true as const };
    const found = await findUrl(dir, variable, deps.envFiles);
    const described = found ? { ...describeUrl(found.value, schemaDir), source: found.source } : null;
    return { variable, datasource, found: described, literal: false as const };
  }

  /** Runs `prisma <args>` in the package; lines go to the log unless quiet (test login: Prisma names the user). */
  async function start(ctx: Ctx, args: string[], opts: { quiet?: boolean; stdin?: string; label: string }) {
    const env = { ...(await ctx.platform.resolveShellEnv()), FORCE_COLOR: '1' };
    const { command, args: full } = prismaCommand(ctx.project.packageManager, args);
    const child = ctx.platform.spawnCommand({ cwd: ctx.project.path, command, args: full, env, ...(opts.stdin === undefined ? {} : { stdin: opts.stdin }) });
    const run: Run = { child, stopping: false, killTree: (pid) => ctx.platform.killTree(pid) };
    const state = stateOf(ctx);
    state.logs.push('system', `▸ ${opts.label}`);
    let output = '';
    const splitters = { stdout: new LineSplitter(), stderr: new LineSplitter() };
    for (const stream of ['stdout', 'stderr'] as const) {
      child[stream]?.on('data', (chunk: Buffer) => {
        if (opts.quiet) {
          if (output.length < 64 * 1024) output += chunk.toString('utf8');
          return;
        }
        for (const line of splitters[stream].push(chunk)) state.logs.push(stream, line);
      });
    }
    const done = new Promise<{ code: number | null; output: string; failedToStart: boolean }>((resolve) => {
      let ended = false;
      const end = (code: number | null, failedToStart: boolean) => {
        if (ended) return;
        ended = true;
        if (!opts.quiet) for (const stream of ['stdout', 'stderr'] as const) for (const line of splitters[stream].flush(true)) state.logs.push(stream, line);
        resolve({ code, output, failedToStart });
      };
      child.once('error', () => end(null, true));
      child.once('close', (code: number | null) => end(code, false));
    });
    return { run, done, state };
  }

  function changed(ctx: Ctx, state: State): void {
    // Nothing to tell about a project that was removed meanwhile.
    if (states.get(ctx.project.id) === state) ctx.emit('changed', undefined);
  }

  function schemaArgs(ctx: Ctx): string[] {
    return ['--schema', schemaOf(ctx)];
  }

  /** The schema arguments, once Prisma is known to be there: npx --no-install would only fail obscurely. */
  async function prismaArgs(ctx: Ctx): Promise<string[]> {
    const args = schemaArgs(ctx);
    if (!(await prismaInstalled(ctx.project.path))) throw new NestboxError('NOT_FOUND', NOT_INSTALLED);
    return args;
  }

  return defineMainTool({
    ...databaseDefinition,
    contract: databaseContract,
    handlers: {
      status: async (ctx: Ctx): Promise<DbStatus> => {
        const { variable, found, literal } = await target(ctx);
        const state = states.get(ctx.project.id);
        const running = { command: state?.command?.kind ?? null, studio: state?.studio ? { port: state.studio.port } : null };
        const prisma = ctx.project.prismaSchema === null ? null : { schema: ctx.project.prismaSchema };
        if (literal) return { prisma, variable, url: { state: 'literal' }, reach: null, running };
        if (!found) {
          const configTs = (await Promise.all(CONFIG_FILES.map((f) => exists(join(ctx.project.path, f))))).some(Boolean);
          return { prisma, variable, url: { state: 'missing', configTs }, reach: null, running };
        }
        // Not logged: status runs on every window focus.
        const reach = await deps.checkReachable(found);
        return { prisma, variable, url: { state: 'set', target: found }, reach, running };
      },

      testLogin: async (ctx: Ctx) => {
        const args = ['db', 'execute', '--stdin', ...schemaArgs(ctx)];
        const { datasource } = await target(ctx);
        if (datasource?.provider === 'mongodb') throw new NestboxError('VALIDATION', 'Prisma cannot run SQL against MongoDB');
        if (!(await prismaInstalled(ctx.project.path))) return { ok: false, message: NOT_INSTALLED };
        const state = stateOf(ctx);
        if (state.command) throw new NestboxError('CONFLICT', 'A Prisma command is already running for this package');
        const { run, done } = await start(ctx, args, { quiet: true, stdin: 'SELECT 1', label: 'prisma db execute (test login)' });
        state.command = { kind: 'test-login', run };
        changed(ctx, state);
        const timer = setTimeout(() => void stopRun(run), LOGIN_TIMEOUT_MS);
        const { code, output, failedToStart } = await done;
        clearTimeout(timer);
        if (state.command?.run === run) state.command = null;
        const result = failedToStart
          ? { ok: false, message: 'Prisma could not be started' }
          : run.stopping
            ? { ok: false, message: 'No answer within 20 s' }
            : code === 0
              ? { ok: true, message: 'Login works' }
              : { ok: false, message: firstPrismaCode(output) ? loginMessage(firstPrismaCode(output)) : `Failed (exit code ${code ?? 'unknown'})` };
        state.logs.push('system', `■ ${result.message}`);
        deps.logger.info('database test login', { projectId: ctx.project.id, ok: result.ok, code: firstPrismaCode(output) ?? String(code) });
        changed(ctx, state);
        return result;
      },

      run: async (ctx: Ctx, { command }) => {
        const args = [...COMMAND_ARGS[command], ...(await prismaArgs(ctx))];
        const state = stateOf(ctx);
        if (state.command) throw new NestboxError('CONFLICT', 'A Prisma command is already running for this package');
        const { run, done } = await start(ctx, args, { label: `prisma ${COMMAND_ARGS[command].join(' ')}` });
        state.command = { kind: command, run };
        void done.then(({ code, failedToStart }) => {
          state.logs.push('system', failedToStart ? '■ Prisma could not be started' : run.stopping ? '■ stopped' : code === 0 ? '■ done' : `■ exited with code ${code ?? 'unknown'}`);
          if (state.command?.run === run) state.command = null;
          changed(ctx, state);
        });
        deps.logger.info('database command', { projectId: ctx.project.id, command });
        changed(ctx, state);
      },

      stop: async (ctx: Ctx, { what }) => {
        const state = states.get(ctx.project.id);
        await stopRun(what === 'command' ? state?.command?.run : state?.studio?.run);
      },

      migrateDev: async (ctx: Ctx) => {
        const { command, args } = prismaCommand(ctx.project.packageManager, ['migrate', 'dev', ...(await prismaArgs(ctx))]);
        await ctx.platform.openTerminal(ctx.project.path, [command, ...args].join(' '));
      },

      startStudio: async (ctx: Ctx) => {
        const schema = await prismaArgs(ctx);
        const state = stateOf(ctx);
        if (state.studio) throw new NestboxError('CONFLICT', 'Prisma Studio is already running for this package');
        const port = await deps.firstFreePort(STUDIO_PORT, '127.0.0.1');
        if (port === null) throw new NestboxError('CONFLICT', 'No free port for Prisma Studio');
        const { run, done } = await start(ctx, ['studio', '--port', String(port), '--browser', 'none', ...schema], { label: `prisma studio on port ${port}` });
        state.studio = { port, run };
        void done.then(({ code, failedToStart }) => {
          state.logs.push('system', failedToStart ? '■ Prisma could not be started' : run.stopping ? '■ Studio stopped' : `■ Studio stopped (code ${code ?? 'unknown'})`);
          if (state.studio?.run === run) state.studio = null;
          changed(ctx, state);
        });
        deps.logger.info('database studio', { projectId: ctx.project.id, port });
        changed(ctx, state);
        return { port };
      },

      getLogs: async (ctx: Ctx, { afterSeq }) => stateOf(ctx).logs.snapshot(afterSeq),
      clearLogs: async (ctx: Ctx) => stateOf(ctx).logs.clear(),
    },
    busy: () => [...states.values()].some((s) => s.command !== null || s.studio !== null),
    async dispose() {
      await Promise.all([...states.values()].flatMap((s) => [stopRun(s.command?.run), stopRun(s.studio?.run)]));
      for (const s of states.values()) s.logs.dispose();
    },
    forgetProject(rootId) {
      for (const [id, s] of states) {
        if (!belongsTo(id, rootId)) continue;
        void stopRun(s.command?.run);
        void stopRun(s.studio?.run);
        s.logs.dispose();
        states.delete(id);
      }
    },
  });
}
