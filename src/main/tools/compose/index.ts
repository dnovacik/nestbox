// The Compose tool: services of the package's compose file with their state, actions per service or for the
// stack, and one followed service log. Docker runs the containers: NestBox never stops them on quit.
import { NestboxError } from '@shared/errors';
import { belongsTo, type LogLine } from '@shared/processes';
import {
  type ComposeAction,
  composeContract,
  composeDefinition,
  type ComposeStatus,
} from '@shared/tools/compose/contract';
import type { Logger } from '../../logger';
import { type AnyMainTool, defineMainTool, type ToolContext } from '../types';
import { classifyFailure } from './errors';
import { mergeServices, parsePs, parseServices } from './parse';
import { collect, ComposePackage } from './runner';

export interface ComposeToolDeps {
  logger: Logger;
}

type Ctx = ToolContext<Record<string, never>>;

const CACHE_MS = 1_000;
const QUERY_TIMEOUT_MS = 20_000;
const SERVICES_MAX_BYTES = 256 * 1024;
const PS_MAX_BYTES = 2 * 1024 * 1024;

interface Cached {
  at: number;
  status:
    | Exclude<ComposeStatus, { state: 'ok' }>
    | { state: 'ok'; file: string; services: Extract<ComposeStatus, { state: 'ok' }>['services'] };
}

export function createComposeTool(deps: ComposeToolDeps): AnyMainTool {
  /** By project id (root or workspace package). */
  const packages = new Map<string, ComposePackage>();
  const cache = new Map<string, Cached>();

  const fileOf = (ctx: Ctx): string => {
    const file = ctx.project.dockerCompose;
    if (file === null) throw new NestboxError('NOT_FOUND', 'This package has no compose file');
    return file;
  };

  function packageOf(ctx: Ctx): ComposePackage {
    const emit = {
      changed: () => {
        cache.delete(ctx.project.id);
        ctx.emit('changed', undefined);
      },
      logs: (source: 'actions' | 'service', lines: LogLine[]) =>
        ctx.emit('logs', { source, lines }),
    };
    const existing = packages.get(ctx.project.id);
    if (existing) {
      existing.setEmit(emit);
      return existing;
    }
    const created = new ComposePackage({
      platform: ctx.platform,
      logger: deps.logger,
      cwd: ctx.project.path,
      file: fileOf(ctx),
      projectId: ctx.project.id,
      emit,
    });
    packages.set(ctx.project.id, created);
    return created;
  }

  async function query(ctx: Ctx): Promise<Cached['status']> {
    const id = ctx.project.id;
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.status;
    const file = fileOf(ctx);
    const status = await queryFresh(ctx, file);
    cache.set(id, { at: Date.now(), status });
    return status;
  }

  async function queryFresh(ctx: Ctx, file: string): Promise<Cached['status']> {
    const id = ctx.project.id;
    if ((await ctx.platform.commandExists('docker')) === false)
      return { state: 'docker-missing', file };
    const run = (args: string[], maxBytes: number) =>
      collect(ctx.platform, {
        cwd: ctx.project.path,
        file,
        args,
        timeoutMs: QUERY_TIMEOUT_MS,
        maxBytes,
      });
    const config = await run(['config', '--services'], SERVICES_MAX_BYTES);
    if (config.code !== 0) {
      deps.logger.warn('compose status failed', {
        projectId: id,
        step: 'config',
        code: config.code ?? 'none',
      });
      return {
        state: classifyFailure(config.stderr) === 'daemon-down' ? 'daemon-down' : 'invalid',
        file,
      };
    }
    const ps = await run(['ps', '--all', '--format', 'json'], PS_MAX_BYTES);
    if (ps.code !== 0) {
      deps.logger.warn('compose status failed', {
        projectId: id,
        step: 'ps',
        code: ps.code ?? 'none',
      });
      return {
        state: classifyFailure(ps.stderr) === 'daemon-down' ? 'daemon-down' : 'invalid',
        file,
      };
    }
    return {
      state: 'ok',
      file,
      services: mergeServices(parseServices(config.stdout), parsePs(ps.stdout)),
    };
  }

  /** A service name from the renderer must be one of the file's services right now. */
  async function knownService(ctx: Ctx, service: string | undefined): Promise<string | null> {
    if (service === undefined) return null;
    const status = await query(ctx);
    if (status.state !== 'ok' || !status.services.some((s) => s.name === service)) {
      throw new NestboxError('VALIDATION', 'Unknown service');
    }
    return service;
  }

  /** Names from a run group may have left the file since: those are dropped, and none left is NOT_FOUND. */
  async function knownServices(ctx: Ctx, services: readonly string[]): Promise<string[]> {
    const status = await query(ctx);
    const known =
      status.state === 'ok'
        ? services.filter((n) => status.services.some((s) => s.name === n))
        : [];
    if (known.length === 0)
      throw new NestboxError('NOT_FOUND', 'None of these services are in the compose file');
    return known;
  }

  interface ActInput {
    service?: string;
    services?: string[];
    wait?: boolean;
  }

  async function act(ctx: Ctx, name: ComposeAction, { service, services, wait }: ActInput = {}) {
    const known =
      services !== undefined && services.length > 0
        ? await knownServices(ctx, services)
        : [await knownService(ctx, service)].filter((s): s is string => s !== null);
    return packageOf(ctx).runAction(name, known, { wait: wait ?? false });
  }

  async function forget(predicate: (id: string) => boolean): Promise<void> {
    const gone = [...packages].filter(([id]) => predicate(id));
    for (const [id] of gone) packages.delete(id);
    for (const id of [...cache.keys()]) if (predicate(id)) cache.delete(id);
    await Promise.all(gone.map(([, pkg]) => pkg.dispose()));
  }

  return defineMainTool({
    ...composeDefinition,
    contract: composeContract,
    handlers: {
      async status(ctx: Ctx): Promise<ComposeStatus> {
        const status = await query(ctx);
        if (status.state !== 'ok') return status;
        const pkg = packages.get(ctx.project.id);
        return { ...status, action: pkg?.action ?? null, following: pkg?.following ?? null };
      },
      up: (ctx: Ctx, input) => act(ctx, 'up', input),
      stop: (ctx: Ctx, input) => act(ctx, 'stop', input),
      restart: (ctx: Ctx, { service }) => act(ctx, 'restart', { service }),
      down: (ctx: Ctx) => act(ctx, 'down'),
      async follow(ctx: Ctx, { service }) {
        await packageOf(ctx).follow((await knownService(ctx, service)) as string);
      },
      async unfollow(ctx: Ctx) {
        await packages.get(ctx.project.id)?.unfollow();
      },
      getLogs: async (ctx: Ctx, { source, afterSeq }) =>
        packageOf(ctx).logs[source].snapshot(afterSeq),
      clearLogs: async (ctx: Ctx, { source }) => packageOf(ctx).logs[source].clear(),
    },
    async dispose() {
      await forget(() => true);
    },
    forgetProject(rootId) {
      void forget((id) => belongsTo(id, rootId));
    },
  });
}
