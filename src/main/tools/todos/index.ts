import { stat } from 'node:fs/promises';
import { NestboxError } from '@shared/errors';
import { belongsTo } from '@shared/processes';
import { DEFAULT_TAGS, type TodoScan, todosContract, todosDefinition } from '@shared/tools/todos/contract';
import { resolveInside } from '../../fs/inside';
import type { Logger } from '../../logger';
import { type AnyMainTool, defineMainTool, type ToolContext } from '../types';
import { LS_MAX_BYTES, listFiles } from './files';
import { scanFiles } from './scan';

export interface TodosToolDeps {
  logger: Logger;
  now?: () => number;
}

type Ctx = ToolContext<{ tags: string[] }>;

const MAX_FILES = 20_000;
const LS_TIMEOUT_MS = 20_000;

export function createTodosTool(deps: TodosToolDeps): AnyMainTool {
  const now = deps.now ?? Date.now;
  /** By project id: the last result, in memory only (TODO text is project content). */
  const results = new Map<string, TodoScan>();
  const running = new Map<string, Promise<TodoScan>>();

  const tagsOf = (ctx: Ctx) => ctx.settings.get().tags ?? DEFAULT_TAGS;

  async function runScan(ctx: Ctx): Promise<TodoScan> {
    const dir = ctx.project.path;
    const started = now();
    const list = await listFiles(dir, {
      maxFiles: MAX_FILES,
      exec: (args) => ctx.platform.execCommand('git', args, { cwd: dir, timeoutMs: LS_TIMEOUT_MS, maxBytes: LS_MAX_BYTES }),
    });
    const scanned = await scanFiles(dir, list.files, tagsOf(ctx), { now });
    const result: TodoScan = {
      scannedAt: now(),
      source: list.source,
      files: scanned.files,
      todos: scanned.todos,
      truncated: scanned.truncated ?? (list.truncated ? 'files' : null),
      durationMs: Math.max(0, now() - started),
    };
    deps.logger.info('todos scan', {
      projectId: ctx.project.id,
      source: result.source,
      files: result.files,
      matches: result.todos.length,
      truncated: result.truncated ?? 'none',
      ms: result.durationMs,
    });
    return result;
  }

  function forget(predicate: (projectId: string) => boolean): void {
    for (const id of [...results.keys()]) if (predicate(id)) results.delete(id);
  }

  return defineMainTool({
    ...todosDefinition,
    contract: todosContract,
    handlers: {
      results: async (ctx: Ctx) => results.get(ctx.project.id) ?? null,

      scan: async (ctx: Ctx) => {
        const id = ctx.project.id;
        const existing = running.get(id);
        if (existing) return existing;
        const scan = runScan(ctx)
          .then((result) => {
            results.set(id, result);
            return result;
          })
          .finally(() => running.delete(id));
        running.set(id, scan);
        return scan;
      },

      openFile: async (ctx: Ctx, { path, line }) => {
        const abs = resolveInside(ctx.project.path, path);
        if (!(await stat(abs).catch(() => null))?.isFile()) throw new NestboxError('NOT_FOUND', 'That file no longer exists');
        await ctx.platform.openInEditor(abs, line);
      },

      getTags: async (ctx: Ctx) => tagsOf(ctx),

      setTags: async (ctx: Ctx, { tags }) => {
        const saved = ctx.settings.update((s) => ({ ...s, tags }));
        // Tags are a root setting: every package of this root has stale results now.
        forget((id) => belongsTo(id, ctx.project.rootId));
        return saved.tags;
      },
    },
    forgetProject(rootId) {
      forget((id) => belongsTo(id, rootId));
    },
  });
}
