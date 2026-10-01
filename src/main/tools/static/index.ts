import { stat } from 'node:fs/promises';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { Socket } from 'node:net';
import { basename, isAbsolute, join, relative } from 'node:path';
import { NestboxError } from '@shared/errors';
import { belongsTo, type LogLine } from '@shared/processes';
import {
  DEFAULT_STATIC_PORT,
  type ServerConfig,
  ServerConfigSchema,
  type ServerStatus,
  staticContract,
  staticDefinition,
  type StaticSettings,
} from '@shared/tools/static/contract';
import type { Logger } from '../../logger';
import { BatchedLog } from '../batched-log';
import { type AnyMainTool, defineMainTool, type ToolContext } from '../types';
import type { CertStore } from './cert-store';
import { createStaticHandler, type RequestLog } from './handler';
import { firstFreePort } from './net';

export interface StaticToolDeps {
  certStore: CertStore;
  /** Native folder picker opened at defaultPath; null when cancelled. */
  pickFolder(defaultPath: string): Promise<string | null>;
  lanAddresses(): string[];
  logger: Logger;
}

const LOG_LINES = 2_000;

type Ctx = ToolContext<StaticSettings>;

interface Running {
  server: Server;
  sockets: Set<Socket>;
  port: number;
  protocol: 'http' | 'https';
  folder: string;
  /** The config it was started with (to tell when a restart would apply changes). */
  config: ServerConfig;
}

interface ProjectState {
  running: Running | null;
  logs: BatchedLog;
}

/** ANSI colour per status class, so the log viewer shows errors at a glance. */
function statusColour(status: number): string {
  if (status >= 500) return '31';
  if (status >= 400) return '33';
  if (status >= 300) return '36';
  return '32';
}

export function createStaticTool(deps: StaticToolDeps): AnyMainTool {
  /** By project id (root or workspace package). */
  const states = new Map<string, ProjectState>();

  function stateOf(ctx: Ctx): ProjectState {
    const existing = states.get(ctx.project.id);
    const emit = (lines: LogLine[]) => ctx.emit('logs', { lines });
    if (existing) {
      existing.logs.emit = emit;
      return existing;
    }
    const created: ProjectState = { running: null, logs: new BatchedLog(LOG_LINES, emit) };
    states.set(ctx.project.id, created);
    return created;
  }

  function log(state: ProjectState, text: string, stream: LogLine['stream']): void {
    state.logs.push(stream, text);
  }

  const configOf = (ctx: Ctx): ServerConfig =>
    ctx.settings.get().servers[ctx.project.relPath] ?? ServerConfigSchema.parse({});

  function folderOf(ctx: Ctx, config: ServerConfig): string {
    const base = ctx.project.path;
    if (config.folder === null) return ctx.project.buildOutput ? join(base, ctx.project.buildOutput) : base;
    return isAbsolute(config.folder) ? config.folder : join(base, config.folder);
  }

  function statusOf(ctx: Ctx): ServerStatus {
    const state = states.get(ctx.project.id);
    const config = configOf(ctx);
    const running = state?.running ?? null;
    const folder = running?.folder ?? folderOf(ctx, config);
    const url = (host: string) => (running ? `${running.protocol}://${host}:${running.port}/` : null);
    return {
      running: running !== null,
      folder,
      port: running?.port ?? config.port,
      localUrl: url('localhost'),
      lanUrls: running?.config.lan ? deps.lanAddresses().map((ip) => url(ip) ?? '') : [],
      configChanged: running !== null && JSON.stringify(running.config) !== JSON.stringify(config),
      servesPackageRoot: ctx.platform.samePath(folder, ctx.project.path),
    };
  }

  async function stopState(state: ProjectState): Promise<void> {
    const running = state.running;
    if (!running) return;
    state.running = null;
    await new Promise<void>((resolve) => {
      running.server.close(() => resolve());
      for (const socket of running.sockets) socket.destroy();
    });
    log(state, '■ stopped', 'system');
  }

  async function start(ctx: Ctx): Promise<ServerStatus> {
    const state = stateOf(ctx);
    if (state.running) return statusOf(ctx);
    const config = configOf(ctx);
    const folder = folderOf(ctx, config);
    if (!(await stat(folder).catch(() => null))?.isDirectory()) {
      throw new NestboxError('NOT_FOUND', 'The folder to serve does not exist');
    }
    const host = config.lan ? '0.0.0.0' : '127.0.0.1';
    const port = config.port ?? (await firstFreePort(DEFAULT_STATIC_PORT, host));
    if (port === null) throw new NestboxError('CONFLICT', 'No free port found');

    const handler = createStaticHandler({
      folder,
      spa: config.spa,
      cors: config.cors,
      noCache: config.noCache,
      latencyMs: config.latencyMs,
      onRequest: (r: RequestLog) =>
        log(state, `\u001b[${statusColour(r.status)}m${r.status}\u001b[39m ${r.method} ${r.path} ${r.ms} ms`, r.status >= 400 ? 'stderr' : 'stdout'),
    });
    const server = config.https
      ? createHttpsServer(await deps.certStore.get(config.lan ? deps.lanAddresses() : []), handler)
      : createHttpServer(handler);
    const sockets = new Set<Socket>();
    server.on('connection', (socket: Socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        reject(
          error.code === 'EADDRINUSE'
            ? new NestboxError('CONFLICT', `Port ${port} is in use`)
            : new NestboxError('INTERNAL', 'Could not start the server'),
        );
      });
      server.listen(port, host, () => resolve());
    });
    const protocol = config.https ? 'https' : 'http';
    state.running = { server, sockets, port, protocol, folder, config };
    log(state, `▸ serving ${basename(folder)} on ${protocol}://localhost:${port}/`, 'system');
    deps.logger.info('static server started', { port, https: config.https, lan: config.lan });
    ctx.emit('changed', undefined);
    return statusOf(ctx);
  }

  return defineMainTool({
    ...staticDefinition,
    contract: staticContract,
    handlers: {
      config: async (ctx: Ctx) => configOf(ctx),
      setConfig: async (ctx: Ctx, { config }) => {
        const saved = ctx.settings.update((s) => ({ ...s, servers: { ...s.servers, [ctx.project.relPath]: config } }));
        return saved.servers[ctx.project.relPath] ?? config;
      },
      status: async (ctx: Ctx) => statusOf(ctx),
      start: (ctx: Ctx) => start(ctx),
      stop: async (ctx: Ctx) => {
        const state = states.get(ctx.project.id);
        if (state) await stopState(state);
        ctx.emit('changed', undefined);
        return statusOf(ctx);
      },
      running: async () =>
        [...states.entries()].flatMap(([projectId, s]) =>
          s.running ? [{ projectId, url: `${s.running.protocol}://localhost:${s.running.port}/` }] : [],
        ),
      nextFreePort: async (ctx: Ctx) => {
        const config = configOf(ctx);
        const port = await firstFreePort(config.port ?? DEFAULT_STATIC_PORT, config.lan ? '0.0.0.0' : '127.0.0.1');
        if (port === null) throw new NestboxError('CONFLICT', 'No free port found');
        return { port };
      },
      pickFolder: async (ctx: Ctx) => {
        const picked = await deps.pickFolder(folderOf(ctx, configOf(ctx)));
        if (picked === null) return { folder: null };
        const rel = relative(ctx.project.path, picked);
        const inside = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
        return { folder: inside ? rel.split('\\').join('/') : picked };
      },
      getLogs: async (ctx: Ctx, { afterSeq }) => stateOf(ctx).logs.snapshot(afterSeq),
      clearLogs: async (ctx: Ctx) => {
        stateOf(ctx).logs.clear();
      },
    },
    async dispose() {
      await Promise.all([...states.values()].map((s) => stopState(s)));
      for (const s of states.values()) s.logs.dispose();
    },
    forgetProject(rootId) {
      for (const [id, s] of states) {
        if (!belongsTo(id, rootId)) continue;
        void stopState(s).then(() => s.logs.dispose());
        states.delete(id);
      }
    },
  });
}
