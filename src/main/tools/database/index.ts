import type { ChildProcess } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { NestboxError } from '@shared/errors';
import { belongsTo, type LogLine } from '@shared/processes';
import {
  databaseContract,
  databaseDefinition,
  type DbConnection,
  EF_INSTALL_COMMAND,
  type DbStatus,
  type EfInput,
  type EfKind,
  type EfMigration,
  type PrismaCommand,
} from '@shared/tools/database/contract';
import { type DotnetInfo, DotnetInfoSchema } from '../../ecosystems/dotnet/detect';
import { DOTNET_ENV } from '../../ecosystems/dotnet/env';
import type { RunEnv, RunEnvContext } from '../../ecosystems/types';
import type { Logger } from '../../logger';
import { LineSplitter } from '../../processes/line-splitter';
import { withPathFirst } from '../../processes/process-manager';
import { BatchedLog } from '../batched-log';
import type { ConfigFileAccess, EnvFileAccess } from '../env/env-files';
import { type AnyMainTool, defineMainTool, type ToolContext } from '../types';
import { describeConnectionString } from './ado';
import { environmentsFor, readConnections } from './connections';
import { efArgs, efLabel, needsConfirm } from './ef-command';
import { efLine, mentionsRestore, parseMigrationList } from './ef-parse';
import { type EfTool, findDbContexts, findEfTool } from './ef-project';
import { firstPrismaCode, loginMessage, prismaCommand } from './prisma';
import type { checkReachable as CheckReachable } from './reach';
import { readDatasource } from './schema';
import { findUrl } from './source';
import { describeUrl } from './url';

export interface DatabaseToolDeps {
  envFiles: Pick<EnvFileAccess, 'read'>;
  /** appsettings*.json, for a .NET package's ConnectionStrings. */
  configFiles: Pick<ConfigFileAccess, 'list' | 'read'>;
  checkReachable: typeof CheckReachable;
  firstFreePort(start: number, host: string): Promise<number | null>;
  logger: Logger;
  /** Electron's clipboard in production. */
  clipboard: { writeText(text: string): void };
  /** The user's home folder: a global dotnet-ef can sit in ~/.dotnet/tools. */
  home: string;
  /** The dotnet ecosystem's runEnv (dotnet from ~/.dotnet when it isn't on PATH). */
  dotnetRunEnv(ctx: RunEnvContext, info: DotnetInfo): Promise<RunEnv>;
}

type Ctx = ToolContext<Record<string, never>>;

const LOG_LINES = 2_000;
const LOGIN_TIMEOUT_MS = 20_000;
const STUDIO_PORT = 5555;
const CONFIG_FILES = [
  'prisma.config.ts',
  'prisma.config.mts',
  'prisma.config.js',
  'prisma.config.mjs',
];
const COMMAND_ARGS: Record<PrismaCommand, string[]> = {
  'migrate-status': ['migrate', 'status'],
  generate: ['generate'],
};
const OUTPUT_MAX = 64 * 1024;
const EF_TIMEOUT_MS = 10 * 60_000;
const RUN_ENV_TIMEOUT_MS = 3_000;
const CONTEXTS_CACHE_MS = 10_000;

interface Run {
  child: ChildProcess;
  stopping: boolean;
  killTree(pid: number): Promise<void>;
}

interface State {
  command: { kind: PrismaCommand | 'test-login' | EfKind; run: Run } | null;
  studio: { port: number; run: Run } | null;
  logs: BatchedLog;
  /** The last EF list per context ('' for none) and the environment it was read for. Memory only. */
  migrations: Map<string, { environment: string; items: EfMigration[] }>;
  /** The last EF run said the local tool needs `dotnet tool restore`. */
  needsRestore: boolean;
}

interface SpawnSpec {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  stdin?: string;
}

/** What an EF command needs once the handler has checked that it can run. */
interface EfSetup {
  info: DotnetInfo & { project: string };
  tool: EfTool;
  contexts: string[];
  context: string | null;
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null)) !== null;
}

/** Whether `prisma` resolves from dir the way Node finds packages: node_modules here or in a parent (a workspace root). */
export async function prismaInstalled(dir: string): Promise<boolean> {
  for (let current = dir; ;) {
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
  /** DbContext names by project id, read again after 10 s. */
  const contextCache = new Map<string, { at: number; contexts: string[] }>();

  function stateOf(ctx: Ctx): State {
    const emit = (lines: LogLine[]) => ctx.emit('logs', { lines });
    const existing = states.get(ctx.project.id);
    if (existing) {
      existing.logs.emit = emit;
      return existing;
    }
    const created: State = {
      command: null,
      studio: null,
      logs: new BatchedLog(LOG_LINES, emit),
      migrations: new Map(),
      needsRestore: false,
    };
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
    const schemaDir =
      schemaPath === null ? dir : schema?.endsWith('.prisma') ? dirname(schemaPath) : schemaPath;
    if (datasource?.literal) return { variable, datasource, found: null, literal: true as const };
    const found = await findUrl(dir, variable, deps.envFiles);
    const described = found
      ? { ...describeUrl(found.value, schemaDir), source: found.source }
      : null;
    return { variable, datasource, found: described, literal: false as const };
  }

  /** `prisma <args>` through the package manager, with the shell env. */
  async function prismaSpawn(ctx: Ctx, args: string[], stdin?: string): Promise<SpawnSpec> {
    const env = { ...(await ctx.platform.resolveShellEnv()), FORCE_COLOR: '1' };
    const { command, args: full } = prismaCommand(ctx.project.packageManager, args);
    return { command, args: full, env, ...(stdin === undefined ? {} : { stdin }) };
  }

  /**
   * Runs a command in the package. Lines go to the log unless quiet (test login: Prisma names the user); a
   * line hook returns the text to log, or null to drop it. The output (64 KiB) is kept for checks, never logged.
   */
  function start(
    ctx: Ctx,
    spawn: SpawnSpec,
    opts: { quiet?: boolean; label: string; line?(text: string): string | null },
  ) {
    const child = ctx.platform.spawnCommand({ cwd: ctx.project.path, ...spawn });
    const run: Run = { child, stopping: false, killTree: (pid) => ctx.platform.killTree(pid) };
    const state = stateOf(ctx);
    state.logs.push('system', `▸ ${opts.label}`);
    let output = '';
    const splitters = { stdout: new LineSplitter(), stderr: new LineSplitter() };
    const push = (stream: 'stdout' | 'stderr', line: string) => {
      const text = opts.line ? opts.line(line) : line;
      if (text !== null) state.logs.push(stream, text);
    };
    for (const stream of ['stdout', 'stderr'] as const) {
      child[stream]?.on('data', (chunk: Buffer) => {
        if (output.length < OUTPUT_MAX) output += chunk.toString('utf8');
        if (opts.quiet) return;
        for (const line of splitters[stream].push(chunk)) push(stream, line);
      });
    }
    const done = new Promise<{ code: number | null; output: string; failedToStart: boolean }>(
      (resolve) => {
        let ended = false;
        const end = (code: number | null, failedToStart: boolean) => {
          if (ended) return;
          ended = true;
          if (!opts.quiet)
            for (const stream of ['stdout', 'stderr'] as const)
              for (const line of splitters[stream].flush(true)) push(stream, line);
          resolve({ code, output, failedToStart });
        };
        child.once('error', () => end(null, true));
        child.once('close', (code: number | null) => end(code, false));
      },
    );
    return { run, done, state };
  }

  function changed(ctx: Ctx, state: State): void {
    // Nothing to tell about a project that was removed meanwhile.
    if (states.get(ctx.project.id) === state) ctx.emit('changed', undefined);
  }

  function dotnetInfo(ctx: Ctx): DotnetInfo | null {
    const entry = ctx.project.ecosystems.find((e) => e.id === 'dotnet');
    const info = entry ? DotnetInfoSchema.safeParse(entry.info) : null;
    return info?.success ? info.data : null;
  }

  const defaultEnvironment = (info: DotnetInfo | null): string =>
    info?.launchProfiles[0]?.environment ?? 'Production';

  /** ConnectionStrings for one environment, described and checked; null without a .NET project. */
  async function dotnetConnections(
    ctx: Ctx,
    info: DotnetInfo | null,
    environment: string,
  ): Promise<DbStatus['dotnet']> {
    if (info === null || info.project === null) return null;
    const dir = ctx.project.path;
    const listed = (await deps.configFiles.list(dir).catch(() => [])).map((f) => f.name);
    const profiles = info.launchProfiles;
    const { connections, truncated } = await readConnections(dir, deps.configFiles, environment);
    const described = await Promise.all(
      connections.map(async ({ name, file, value }): Promise<DbConnection> => {
        if (value === null) {
          return {
            name,
            file,
            target: { provider: 'unknown', host: null, port: null, database: null, file: null },
            reach: { result: 'not-checked', reason: 'Not a text value' },
          };
        }
        // The value is dropped here: only its description leaves.
        const { target, skip } = describeConnectionString(value, {
          providers: info.dbProviders,
          dir,
        });
        const reach =
          skip === null
            ? await deps.checkReachable(target)
            : { result: 'not-checked' as const, reason: skip };
        return { name, file, target, reach };
      }),
    );
    deps.logger.info('database connections', {
      projectId: ctx.project.id,
      connections: described.length,
      reachable: described.filter((c) => c.reach.result === 'reachable').length,
    });
    return {
      environment,
      environments: environmentsFor(profiles, listed),
      connections: described,
      truncated,
    };
  }

  async function efContexts(ctx: Ctx): Promise<string[]> {
    const cached = contextCache.get(ctx.project.id);
    if (cached && Date.now() - cached.at < CONTEXTS_CACHE_MS) return cached.contexts;
    const contexts = await findDbContexts(ctx.project.path);
    contextCache.set(ctx.project.id, { at: Date.now(), contexts });
    return contexts;
  }

  const efTool = (ctx: Ctx) =>
    findEfTool(ctx.project.path, {
      commandExists: (c) => ctx.platform.commandExists(c),
      home: deps.home,
    });

  /** EF Core's part of the status; null unless the package references the EF Core Design package. */
  async function efStatus(
    ctx: Ctx,
    info: DotnetInfo | null,
    environment: string,
    requested: string | undefined,
  ): Promise<DbStatus['ef']> {
    if (!info?.efDesign || info.project === null) return null;
    const [tool, contexts] = await Promise.all([efTool(ctx), efContexts(ctx)]);
    const context =
      requested !== undefined && contexts.includes(requested) ? requested : (contexts[0] ?? null);
    const state = states.get(ctx.project.id);
    const stored = state?.migrations.get(context ?? '');
    return {
      tool,
      contexts,
      context,
      needsRestore: state?.needsRestore ?? false,
      migrations: stored?.environment === environment ? stored : null,
    };
  }

  /** dotnet's env for one environment: the shell's, DOTNET_ENV and the environment variables, dotnet's folder first. */
  async function efEnv(
    ctx: Ctx,
    info: DotnetInfo,
    environment: string,
  ): Promise<NodeJS.ProcessEnv> {
    let timer: NodeJS.Timeout | undefined;
    const runEnv = await Promise.race([
      deps
        .dotnetRunEnv({ dir: ctx.project.path, platform: ctx.platform, settings: {} }, info)
        .catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), RUN_ENV_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);
    const env = {
      ...(await ctx.platform.resolveShellEnv()),
      ...runEnv?.env,
      ...DOTNET_ENV,
      ASPNETCORE_ENVIRONMENT: environment,
      DOTNET_ENVIRONMENT: environment,
    };
    return runEnv?.pathPrepend ? withPathFirst(env, runEnv.pathPrepend) : env;
  }

  /** Starts one EF command. A list fills state.migrations; add, update and remove list again when they succeed. */
  async function runEf(ctx: Ctx, state: State, input: EfInput, ef: EfSetup): Promise<void> {
    const { action, environment } = input;
    const args = efArgs({
      action,
      project: ef.info.project,
      context: ef.contexts.length > 1 ? ef.context : null,
      environment,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.target === undefined ? {} : { target: input.target }),
      idempotent: !(ef.info.dbProviders.length === 1 && ef.info.dbProviders[0] === 'sqlite'),
    });
    const env = await efEnv(ctx, ef.info, environment);
    const data: string[] = [];
    const { run, done } = start(
      ctx,
      { command: 'dotnet', args, env },
      {
        label: efLabel(args, environment),
        line: (raw) => {
          const line = efLine(raw);
          // The list's JSON is read, not shown.
          if (action === 'list' && line.data) {
            data.push(line.text);
            return null;
          }
          return line.text;
        },
      },
    );
    state.command = { kind: `ef-${action}`, run };
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void stopRun(run);
    }, EF_TIMEOUT_MS);
    void done.then(({ code, output, failedToStart }) => {
      clearTimeout(timer);
      state.logs.push(
        'system',
        failedToStart
          ? '■ dotnet could not be started'
          : timedOut
            ? '■ stopped after 10 minutes'
            : run.stopping
              ? '■ stopped'
              : code === 0
                ? '■ done'
                : `■ exited with code ${code ?? 'unknown'}`,
      );
      const ok = code === 0 && !failedToStart && !run.stopping;
      let counts: { migrations: number; pending: number } | null = null;
      if (action === 'list' && ok) {
        const items = parseMigrationList(data);
        if (items === null) state.logs.push('system', "■ Couldn't read the migration list");
        else {
          state.migrations.set(ef.context ?? '', { environment, items });
          counts = {
            migrations: items.length,
            pending: items.filter((m) => m.applied === false).length,
          };
        }
      }
      if (ok) state.needsRestore = false;
      else if (!failedToStart && !run.stopping)
        state.needsRestore = ef.tool === 'local' && mentionsRestore(output);
      deps.logger.info('database ef', {
        projectId: ctx.project.id,
        action,
        code: String(code),
        ...counts,
      });
      if (state.command?.run === run) state.command = null;
      changed(ctx, state);
      if (
        ok &&
        (action === 'add' || action === 'update' || action === 'remove') &&
        states.get(ctx.project.id) === state &&
        !state.command
      ) {
        const list: EfInput = {
          action: 'list',
          environment,
          ...(ef.context === null ? {} : { context: ef.context }),
        };
        void runEf(ctx, state, list, ef).catch(() => undefined);
      }
    });
    changed(ctx, state);
  }

  function schemaArgs(ctx: Ctx): string[] {
    return ['--schema', schemaOf(ctx)];
  }

  /** The schema arguments, once Prisma is known to be there: npx --no-install would only fail obscurely. */
  async function prismaArgs(ctx: Ctx): Promise<string[]> {
    const args = schemaArgs(ctx);
    if (!(await prismaInstalled(ctx.project.path)))
      throw new NestboxError('NOT_FOUND', NOT_INSTALLED);
    return args;
  }

  return defineMainTool({
    ...databaseDefinition,
    contract: databaseContract,
    handlers: {
      status: async (ctx: Ctx, { environment: requested, context }): Promise<DbStatus> => {
        const info = dotnetInfo(ctx);
        const environment = requested ?? defaultEnvironment(info);
        const [{ variable, found, literal }, dotnet, ef] = await Promise.all([
          target(ctx),
          dotnetConnections(ctx, info, environment),
          efStatus(ctx, info, environment, context),
        ]);
        const state = states.get(ctx.project.id);
        const running = {
          command: state?.command?.kind ?? null,
          studio: state?.studio ? { port: state.studio.port } : null,
        };
        const prisma =
          ctx.project.prismaSchema === null ? null : { schema: ctx.project.prismaSchema };
        if (literal)
          return { prisma, variable, url: { state: 'literal' }, reach: null, running, dotnet, ef };
        if (!found) {
          const configTs = (
            await Promise.all(CONFIG_FILES.map((f) => exists(join(ctx.project.path, f))))
          ).some(Boolean);
          return {
            prisma,
            variable,
            url: { state: 'missing', configTs },
            reach: null,
            running,
            dotnet,
            ef,
          };
        }
        // Not logged: status runs on every window focus.
        const reach = await deps.checkReachable(found);
        return {
          prisma,
          variable,
          url: { state: 'set', target: found },
          reach,
          running,
          dotnet,
          ef,
        };
      },

      ef: async (ctx: Ctx, input) => {
        const info = dotnetInfo(ctx);
        const project = info?.efDesign ? info.project : null;
        if (info === null || project === null)
          throw new NestboxError('NOT_FOUND', "This package doesn't use EF Core");
        const tool = await efTool(ctx);
        if (tool === null) throw new NestboxError('NOT_FOUND', "dotnet-ef isn't installed");
        if (input.action === 'restore' && tool !== 'local')
          throw new NestboxError('VALIDATION', 'dotnet-ef is not a local tool');
        const contexts = await efContexts(ctx);
        if (input.context !== undefined && !contexts.includes(input.context))
          throw new NestboxError('VALIDATION', 'Unknown DbContext');
        const context = input.context ?? contexts[0] ?? null;
        if (input.action === 'add' && input.name === undefined)
          throw new NestboxError('VALIDATION', 'A migration needs a name');
        const state = stateOf(ctx);
        if (input.action === 'update' && input.target !== undefined && input.target !== '0') {
          const stored = state.migrations.get(context ?? '');
          if (
            stored?.environment !== input.environment ||
            !stored.items.some((m) => m.id === input.target)
          ) {
            throw new NestboxError('VALIDATION', 'Unknown migration: list the migrations first');
          }
        }
        if (
          needsConfirm(input.action, input.environment, input.target) &&
          input.confirmed !== true
        ) {
          throw new NestboxError('VALIDATION', 'Confirm this command first');
        }
        if (state.command)
          throw new NestboxError('CONFLICT', 'A command is already running for this package');
        await runEf(ctx, state, input, { info: { ...info, project }, tool, contexts, context });
      },

      copyInstallCommand: async () => deps.clipboard.writeText(EF_INSTALL_COMMAND),

      testLogin: async (ctx: Ctx) => {
        const args = ['db', 'execute', '--stdin', ...schemaArgs(ctx)];
        const { datasource } = await target(ctx);
        if (datasource?.provider === 'mongodb')
          throw new NestboxError('VALIDATION', 'Prisma cannot run SQL against MongoDB');
        if (!(await prismaInstalled(ctx.project.path)))
          return { ok: false, message: NOT_INSTALLED };
        const state = stateOf(ctx);
        if (state.command)
          throw new NestboxError(
            'CONFLICT',
            'A Prisma command is already running for this package',
          );
        const { run, done } = start(ctx, await prismaSpawn(ctx, args, 'SELECT 1'), {
          quiet: true,
          label: 'prisma db execute (test login)',
        });
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
              : {
                  ok: false,
                  message: firstPrismaCode(output)
                    ? loginMessage(firstPrismaCode(output))
                    : `Failed (exit code ${code ?? 'unknown'})`,
                };
        state.logs.push('system', `■ ${result.message}`);
        deps.logger.info('database test login', {
          projectId: ctx.project.id,
          ok: result.ok,
          code: firstPrismaCode(output) ?? String(code),
        });
        changed(ctx, state);
        return result;
      },

      run: async (ctx: Ctx, { command }) => {
        const args = [...COMMAND_ARGS[command], ...(await prismaArgs(ctx))];
        const state = stateOf(ctx);
        if (state.command)
          throw new NestboxError(
            'CONFLICT',
            'A Prisma command is already running for this package',
          );
        const { run, done } = start(ctx, await prismaSpawn(ctx, args), {
          label: `prisma ${COMMAND_ARGS[command].join(' ')}`,
        });
        state.command = { kind: command, run };
        void done.then(({ code, failedToStart }) => {
          state.logs.push(
            'system',
            failedToStart
              ? '■ Prisma could not be started'
              : run.stopping
                ? '■ stopped'
                : code === 0
                  ? '■ done'
                  : `■ exited with code ${code ?? 'unknown'}`,
          );
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
        const { command, args } = prismaCommand(ctx.project.packageManager, [
          'migrate',
          'dev',
          ...(await prismaArgs(ctx)),
        ]);
        await ctx.platform.openTerminal(ctx.project.path, [command, ...args].join(' '));
      },

      startStudio: async (ctx: Ctx) => {
        const schema = await prismaArgs(ctx);
        const state = stateOf(ctx);
        if (state.studio)
          throw new NestboxError('CONFLICT', 'Prisma Studio is already running for this package');
        const port = await deps.firstFreePort(STUDIO_PORT, '127.0.0.1');
        if (port === null) throw new NestboxError('CONFLICT', 'No free port for Prisma Studio');
        const spawn = await prismaSpawn(ctx, [
          'studio',
          '--port',
          String(port),
          '--browser',
          'none',
          ...schema,
        ]);
        const { run, done } = start(ctx, spawn, { label: `prisma studio on port ${port}` });
        state.studio = { port, run };
        void done.then(({ code, failedToStart }) => {
          state.logs.push(
            'system',
            failedToStart
              ? '■ Prisma could not be started'
              : run.stopping
                ? '■ Studio stopped'
                : `■ Studio stopped (code ${code ?? 'unknown'})`,
          );
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
      await Promise.all(
        [...states.values()].flatMap((s) => [stopRun(s.command?.run), stopRun(s.studio?.run)]),
      );
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
      for (const id of contextCache.keys()) if (belongsTo(id, rootId)) contextCache.delete(id);
    },
  });
}
