// The Mock API tool: one local server per package answering the user's routes. Routes and toggles live in
// the tool's settings; the running server reads a copy that every edit refreshes, so edits apply at once.
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { NestboxError } from '@shared/errors';
import { belongsTo, type LogLine } from '@shared/processes';
import {
  DEFAULT_MOCK_PORT,
  MAX_ROUTES,
  mockContract,
  mockDefinition,
  type MockSettings,
  type MockStatus,
  type PackageMock,
  PackageMockSchema,
} from '@shared/tools/mock/contract';
import type { Logger } from '../../logger';
import { BatchedLog } from '../batched-log';
import { firstFreePort, isPortFree } from '../net';
import { type AnyMainTool, defineMainTool, type ToolContext } from '../types';
import { createMockHandler } from './handler';

export interface MockToolDeps {
  logger: Logger;
}

type Ctx = ToolContext<MockSettings>;

const HOST = '127.0.0.1';
const LOG_LINES = 5_000;

interface Running {
  server: Server;
  sockets: Set<Socket>;
  port: number;
  requests: number;
}

interface State {
  running: Running | null;
  starting: Promise<MockStatus> | null;
  /** What the running server answers with; refreshed by every edit. */
  config: PackageMock;
  logs: BatchedLog;
}

export function createMockTool(deps: MockToolDeps): AnyMainTool {
  /** By project id (root or workspace package). */
  const states = new Map<string, State>();
  let disposed = false;

  const configOf = (ctx: Ctx): PackageMock =>
    ctx.settings.get().packages[ctx.project.relPath] ?? PackageMockSchema.parse({});

  function stateOf(ctx: Ctx): State {
    const emit = (lines: LogLine[]) => ctx.emit('logs', { lines });
    const existing = states.get(ctx.project.id);
    if (existing) {
      existing.logs.emit = emit;
      return existing;
    }
    const created: State = {
      running: null,
      starting: null,
      config: configOf(ctx),
      logs: new BatchedLog(LOG_LINES, emit),
    };
    states.set(ctx.project.id, created);
    return created;
  }

  function statusOf(ctx: Ctx): MockStatus {
    const running = states.get(ctx.project.id)?.running ?? null;
    const config = configOf(ctx);
    return {
      running: running !== null,
      port: running?.port ?? config.port,
      url: running ? `http://localhost:${running.port}` : null,
      configChanged: running !== null && config.port !== null && config.port !== running.port,
      requests: running?.requests ?? 0,
    };
  }

  function update(ctx: Ctx, fn: (p: PackageMock) => PackageMock): PackageMock {
    const saved = ctx.settings.update((s) => ({
      ...s,
      packages: { ...s.packages, [ctx.project.relPath]: fn(configOf(ctx)) },
    }));
    const config = saved.packages[ctx.project.relPath] ?? PackageMockSchema.parse({});
    stateOf(ctx).config = config;
    ctx.emit('changed', undefined);
    return config;
  }

  async function stopState(state: State): Promise<void> {
    await state.starting?.catch(() => undefined);
    const running = state.running;
    if (!running) return;
    state.running = null;
    await new Promise<void>((resolve) => {
      running.server.close(() => resolve());
      for (const socket of running.sockets) socket.destroy();
    });
    state.logs.push('system', '■ stopped');
    deps.logger.info('mock server stopped', { port: running.port, requests: running.requests });
  }

  async function listen(ctx: Ctx, state: State): Promise<MockStatus> {
    const config = configOf(ctx);
    state.config = config;
    const port = config.port ?? (await firstFreePort(DEFAULT_MOCK_PORT, HOST));
    if (port === null) throw new NestboxError('CONFLICT', 'No free port found');
    if (config.port !== null && !(await isPortFree(port, HOST)))
      throw new NestboxError('CONFLICT', `Port ${port} is in use`);
    const sockets = new Set<Socket>();
    const running: Running = { server: createServer(), sockets, port, requests: 0 };
    running.server.on(
      'request',
      createMockHandler({
        config: () => state.config,
        log: (stream, text) => state.logs.push(stream, text),
        onRequest: () => {
          running.requests++;
        },
      }),
    );
    running.server.on('connection', (socket: Socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      running.server.once('error', (error: NodeJS.ErrnoException) =>
        reject(
          error.code === 'EADDRINUSE'
            ? new NestboxError('CONFLICT', `Port ${port} is in use`)
            : new NestboxError('INTERNAL', 'Could not start the mock server'),
        ),
      );
      running.server.listen(port, HOST, () => resolve());
    });
    if (disposed || states.get(ctx.project.id) !== state) {
      // The project was removed (or the app is quitting) while the server was starting.
      await new Promise<void>((resolve) => running.server.close(() => resolve()));
      throw new NestboxError('NOT_FOUND', 'The project was removed');
    }
    state.running = running;
    state.logs.push(
      'system',
      `▸ mock API on http://localhost:${port} (${config.routes.length} routes)`,
    );
    deps.logger.info('mock server started', { port, routes: config.routes.length });
    ctx.emit('changed', undefined);
    return statusOf(ctx);
  }

  async function start(ctx: Ctx): Promise<MockStatus> {
    const state = stateOf(ctx);
    if (state.starting) await state.starting.catch(() => undefined);
    if (state.running) return statusOf(ctx);
    const starting = listen(ctx, state);
    state.starting = starting;
    try {
      return await starting;
    } finally {
      if (state.starting === starting) state.starting = null;
    }
  }

  return defineMainTool({
    ...mockDefinition,
    contract: mockContract,
    handlers: {
      config: async (ctx: Ctx) => configOf(ctx),
      saveRoute: async (ctx: Ctx, { route }) =>
        update(ctx, (p) => {
          const index = p.routes.findIndex((r) => r.id === route.id);
          if (index === -1 && p.routes.length >= MAX_ROUTES) {
            throw new NestboxError('VALIDATION', `At most ${MAX_ROUTES} routes per package`);
          }
          return {
            ...p,
            routes:
              index === -1
                ? [...p.routes, route]
                : p.routes.map((r) => (r.id === route.id ? route : r)),
          };
        }),
      deleteRoute: async (ctx: Ctx, { id }) =>
        update(ctx, (p) => ({ ...p, routes: p.routes.filter((r) => r.id !== id) })),
      moveRoute: async (ctx: Ctx, { id, to }) =>
        update(ctx, (p) => {
          const from = p.routes.findIndex((r) => r.id === id);
          if (from === -1) throw new NestboxError('NOT_FOUND', 'No such route');
          const routes = [...p.routes];
          const [moved] = routes.splice(from, 1);
          routes.splice(Math.min(to, routes.length), 0, moved as (typeof routes)[number]);
          return { ...p, routes };
        }),
      setOptions: async (ctx: Ctx, options) =>
        update(ctx, (p) => ({
          ...p,
          ...(options.port !== undefined ? { port: options.port } : {}),
          ...(options.delayMs !== undefined ? { delayMs: options.delayMs } : {}),
          ...(options.failAll !== undefined ? { failAll: options.failAll } : {}),
        })),
      status: async (ctx: Ctx) => statusOf(ctx),
      start: (ctx: Ctx) => start(ctx),
      stop: async (ctx: Ctx) => {
        const state = states.get(ctx.project.id);
        if (state) await stopState(state);
        ctx.emit('changed', undefined);
        return statusOf(ctx);
      },
      nextFreePort: async (ctx: Ctx) => {
        const port = await firstFreePort(configOf(ctx).port ?? DEFAULT_MOCK_PORT, HOST);
        if (port === null) throw new NestboxError('CONFLICT', 'No free port found');
        return { port };
      },
      getLogs: async (ctx: Ctx, { afterSeq }) => stateOf(ctx).logs.snapshot(afterSeq),
      clearLogs: async (ctx: Ctx) => {
        stateOf(ctx).logs.clear();
      },
    },
    async dispose() {
      disposed = true;
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
