// The request inspector: a proxy per package in front of the local API. Recordings live in memory only (they
// hold the app's own traffic, tokens included): never stored or logged, and secret headers are masked.
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { NestboxError } from '@shared/errors';
import { belongsTo } from '@shared/processes';
import {
  DEFAULT_INSPECTOR_PORT,
  type InspectorSettings,
  type InspectorStatus,
  inspectorContract,
  inspectorDefinition,
  type PackageInspector,
  PackageInspectorSchema,
} from '@shared/tools/inspector/contract';
import type { Logger } from '../../logger';
import { entries as envEntries, parseEnv } from '../env/dotenv';
import type { EnvFileAccess } from '../env/env-files';
import { firstFreePort, isPortFree } from '../net';
import { type AnyMainTool, defineMainTool, type ToolContext } from '../types';
import { buildCurl } from './curl';
import { createProxyHandler, sendRequest } from './proxy';
import { type Entry, EntryRing, type HeaderPairs, headerOf, sideView, summarize } from './record';

export interface InspectorToolDeps {
  logger: Logger;
  envFiles: Pick<EnvFileAccess, 'read'>;
  /** Electron's clipboard in production: a curl command never goes to the renderer. */
  clipboard: { writeText(text: string): void };
}

type Ctx = ToolContext<InspectorSettings>;

const HOST = '127.0.0.1';
const ENTRIES_EVENT_GAP_MS = 250;

interface Running {
  server: Server;
  sockets: Set<Socket>;
  port: number;
  target: string;
}

interface State {
  running: Running | null;
  starting: Promise<InspectorStatus> | null;
  ring: EntryRing;
  entriesTimer: ReturnType<typeof setTimeout> | null;
  emitEntries: () => void;
}

export function createInspectorTool(deps: InspectorToolDeps): AnyMainTool {
  const states = new Map<string, State>();
  let disposed = false;

  const configOf = (ctx: Ctx): PackageInspector =>
    ctx.settings.get().packages[ctx.project.relPath] ?? PackageInspectorSchema.parse({});

  function stateOf(ctx: Ctx): State {
    const emitEntries = () => ctx.emit('entries', undefined);
    const existing = states.get(ctx.project.id);
    if (existing) {
      existing.emitEntries = emitEntries;
      return existing;
    }
    const created: State = {
      running: null,
      starting: null,
      ring: new EntryRing(),
      entriesTimer: null,
      emitEntries,
    };
    states.set(ctx.project.id, created);
    return created;
  }

  /** At most 4 `entries` events a second: a busy client must not flood the renderer. */
  function entriesChanged(state: State): void {
    if (state.entriesTimer) return;
    state.entriesTimer = setTimeout(() => {
      state.entriesTimer = null;
      state.emitEntries();
    }, ENTRIES_EVENT_GAP_MS);
  }

  function add(state: State, entry: Entry): void {
    state.ring.add(entry);
    entriesChanged(state);
  }

  /** The configured target, else http://localhost:<PORT> from the package's .env (only the number is read). */
  async function resolveTarget(
    ctx: Ctx,
  ): Promise<{ target: string; source: 'setting' | 'env' } | null> {
    const config = configOf(ctx);
    if (config.target) return { target: config.target, source: 'setting' };
    const text = await deps.envFiles
      .read(ctx.project.path, '.env')
      .then((r) => r.text)
      .catch(() => null);
    const port = text === null ? '' : (envEntries(parseEnv(text)).get('PORT')?.trim() ?? '');
    const n = /^\d{1,5}$/.test(port) ? Number(port) : NaN;
    return n >= 1 && n <= 65_535 ? { target: `http://localhost:${n}`, source: 'env' } : null;
  }

  async function statusOf(ctx: Ctx): Promise<InspectorStatus> {
    const state = states.get(ctx.project.id);
    const running = state?.running ?? null;
    const config = configOf(ctx);
    const resolved = await resolveTarget(ctx);
    return {
      running: running !== null,
      port: running?.port ?? config.port,
      url: running ? `http://localhost:${running.port}` : null,
      target: running?.target ?? resolved?.target ?? null,
      targetSource: resolved?.source ?? null,
      configChanged:
        running !== null &&
        ((config.port !== null && config.port !== running.port) ||
          (resolved !== null && resolved.target !== running.target)),
      count: state?.ring.size ?? 0,
    };
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
    deps.logger.info('inspector stopped', { port: running.port, entries: state.ring.size });
  }

  async function listen(ctx: Ctx, state: State): Promise<InspectorStatus> {
    const config = configOf(ctx);
    const resolved = await resolveTarget(ctx);
    if (!resolved) throw new NestboxError('VALIDATION', 'Set the API address, or PORT in .env');
    const port = config.port ?? (await firstFreePort(DEFAULT_INSPECTOR_PORT, HOST));
    if (port === null) throw new NestboxError('CONFLICT', 'No free port found');
    if (config.port !== null && !(await isPortFree(port, HOST)))
      throw new NestboxError('CONFLICT', `Port ${port} is in use`);
    const target = new URL(resolved.target);
    const server = createServer(
      createProxyHandler({ target: () => target, onEntry: (e) => add(state, e) }),
    );
    const sockets = new Set<Socket>();
    server.on('connection', (socket: Socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    // WebSockets aren't proxied (yet).
    server.on('upgrade', (_req, socket: Socket) =>
      socket.end('HTTP/1.1 501 Not Implemented\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'),
    );
    await new Promise<void>((resolve, reject) => {
      server.once('error', (error: NodeJS.ErrnoException) =>
        reject(
          error.code === 'EADDRINUSE'
            ? new NestboxError('CONFLICT', `Port ${port} is in use`)
            : new NestboxError('INTERNAL', 'Could not start the inspector'),
        ),
      );
      server.listen(port, HOST, () => resolve());
    });
    if (disposed || states.get(ctx.project.id) !== state) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      throw new NestboxError('NOT_FOUND', 'The project was removed');
    }
    state.running = { server, sockets, port, target: resolved.target };
    deps.logger.info('inspector started', { port, targetPort: target.port || 'default' });
    ctx.emit('changed', undefined);
    return statusOf(ctx);
  }

  async function start(ctx: Ctx): Promise<InspectorStatus> {
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

  function entryOf(ctx: Ctx, id: string): Entry {
    const entry = states.get(ctx.project.id)?.ring.get(id);
    if (!entry) throw new NestboxError('NOT_FOUND', 'That request is no longer recorded');
    return entry;
  }

  /** Where replays go: the running proxy's target, else the configured one. */
  async function targetUrl(ctx: Ctx): Promise<URL> {
    const running = states.get(ctx.project.id)?.running;
    if (running) return new URL(running.target);
    const resolved = await resolveTarget(ctx);
    if (!resolved) throw new NestboxError('VALIDATION', 'Set the API address, or PORT in .env');
    return new URL(resolved.target);
  }

  async function resend(
    ctx: Ctx,
    from: Entry,
    req: { method: string; path: string; headers: HeaderPairs; body: Buffer },
  ): Promise<{ id: string }> {
    const entry = await sendRequest(await targetUrl(ctx), req, { replayOf: from.id });
    add(stateOf(ctx), entry);
    return { id: entry.id };
  }

  function forget(predicate: (id: string) => boolean): void {
    for (const [id, s] of states) {
      if (!predicate(id)) continue;
      states.delete(id);
      if (s.entriesTimer) clearTimeout(s.entriesTimer);
      s.ring.clear();
      void stopState(s);
    }
  }

  return defineMainTool({
    ...inspectorDefinition,
    contract: inspectorContract,
    handlers: {
      config: async (ctx: Ctx) => configOf(ctx),
      setOptions: async (ctx: Ctx, { port, target }) => {
        const saved = ctx.settings.update((s) => {
          const current = s.packages[ctx.project.relPath] ?? PackageInspectorSchema.parse({});
          const next = {
            ...current,
            ...(port !== undefined ? { port } : {}),
            ...(target !== undefined ? { target } : {}),
          };
          return { ...s, packages: { ...s.packages, [ctx.project.relPath]: next } };
        });
        ctx.emit('changed', undefined);
        return saved.packages[ctx.project.relPath] ?? PackageInspectorSchema.parse({});
      },
      status: (ctx: Ctx) => statusOf(ctx),
      start: (ctx: Ctx) => start(ctx),
      stop: async (ctx: Ctx) => {
        const state = states.get(ctx.project.id);
        if (state) await stopState(state);
        ctx.emit('changed', undefined);
        return statusOf(ctx);
      },
      nextFreePort: async (ctx: Ctx) => {
        const port = await firstFreePort(configOf(ctx).port ?? DEFAULT_INSPECTOR_PORT, HOST);
        if (port === null) throw new NestboxError('CONFLICT', 'No free port found');
        return { port };
      },
      list: async (ctx: Ctx) =>
        (states.get(ctx.project.id)?.ring.newestFirst() ?? []).map(summarize),
      get: async (ctx: Ctx, { id }) => {
        const entry = entryOf(ctx, id);
        return {
          summary: summarize(entry),
          request: sideView(entry.request),
          response: entry.response ? sideView(entry.response) : null,
        };
      },
      reveal: async (ctx: Ctx, { id, side, name }) => {
        const entry = entryOf(ctx, id);
        const headers =
          side === 'request' ? entry.request.headers : (entry.response?.headers ?? []);
        const value = headerOf(headers, name);
        if (value === null) throw new NestboxError('NOT_FOUND', 'No such header');
        return { value };
      },
      replay: async (ctx: Ctx, { id }) => {
        const entry = entryOf(ctx, id);
        if (entry.request.bytes > entry.request.body.length)
          throw new NestboxError(
            'VALIDATION',
            'The body was too large to keep, so it cannot be replayed',
          );
        return resend(ctx, entry, {
          method: entry.method,
          path: entry.path,
          headers: entry.request.headers,
          body: entry.request.body,
        });
      },
      send: async (ctx: Ctx, input) => {
        const from = entryOf(ctx, input.from);
        const headers: HeaderPairs = input.headers.map((h) => {
          if ('value' in h) return [h.name, h.value];
          const kept = headerOf(from.request.headers, h.name);
          if (kept === null)
            throw new NestboxError('VALIDATION', 'A kept header is not in the recorded request');
          return [h.name, kept];
        });
        return resend(ctx, from, {
          method: input.method,
          path: input.path,
          headers,
          body: Buffer.from(input.body, 'utf8'),
        });
      },
      copyCurl: async (ctx: Ctx, { id }) => {
        deps.clipboard.writeText(buildCurl(entryOf(ctx, id), await targetUrl(ctx)));
      },
      clear: async (ctx: Ctx) => {
        const state = states.get(ctx.project.id);
        if (!state) return;
        state.ring.clear();
        entriesChanged(state);
      },
    },
    async dispose() {
      disposed = true;
      await Promise.all([...states.values()].map((s) => stopState(s)));
      for (const s of states.values()) if (s.entriesTimer) clearTimeout(s.entriesTimer);
    },
    forgetProject(rootId) {
      forget((id) => belongsTo(id, rootId));
    },
  });
}
