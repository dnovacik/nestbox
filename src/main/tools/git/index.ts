import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { NestboxError } from '@shared/errors';
import { gitContract, gitDefinition, type GitStatus } from '@shared/tools/git/contract';
import { resolveGitDirs } from '../../detection/git-head';
import { resolveInside } from '../../fs/inside';
import type { Logger } from '../../logger';
import { type AnyMainTool, defineMainTool, type ToolContext } from '../types';
import { parseCommit } from './commit';
import { detectOperation } from './operation';
import { parseStatus } from './status';
import { createGitWatcher, type WatchFn } from './watcher';

export interface GitToolDeps {
  watch: WatchFn;
  logger: Logger;
}

const GIT_TIMEOUT_MS = 10_000;
/** Enough for tens of thousands of changed paths; past it the counts are shown as "N+". */
export const STATUS_MAX_BYTES = 2 * 1024 * 1024;
// --no-optional-locks: status never rewrites the index, so it neither wakes our own watcher nor
// contends with the user's git.
const STATUS_ARGS = ['--no-optional-locks', 'status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal'];

async function mtimeOrNull(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  return (await mtimeOrNull(path)) !== null;
}

export function createGitTool(deps: GitToolDeps): AnyMainTool {
  const watcher = createGitWatcher(deps.watch);

  /** git did not run or failed: is it installed at all? */
  async function failure(ctx: ToolContext, code: string): Promise<GitStatus> {
    deps.logger.warn('git status failed', { code });
    return (await ctx.platform.commandExists('git')) === false ? { state: 'git-missing' } : { state: 'failed' };
  }

  return defineMainTool({
    ...gitDefinition,
    contract: gitContract,
    handlers: {
      async status(ctx): Promise<GitStatus> {
        const cwd = ctx.project.path;
        const dirs = await resolveGitDirs(cwd);
        if (!dirs) return { state: 'not-a-repo' };
        watcher.ensure(ctx.project.id, ctx.project.rootId, dirs, () => ctx.emit('changed', undefined));

        let result;
        try {
          result = await ctx.platform.execCommand('git', STATUS_ARGS, { cwd, timeoutMs: GIT_TIMEOUT_MS, maxBytes: STATUS_MAX_BYTES });
        } catch (error) {
          return failure(ctx, String((error as { code?: unknown }).code ?? 'spawn'));
        }
        if (result.code === 128) return { state: 'not-a-repo' };
        if (result.code === null) {
          deps.logger.warn('git status failed', { code: 'timeout' });
          return { state: 'failed' };
        }
        if (result.code !== 0) return failure(ctx, String(result.code));

        const parsed = parseStatus(result.stdout, result.stdout.length >= STATUS_MAX_BYTES);
        const [lastCommit, lastFetchAt, operation] = await Promise.all([
          parsed.oid === null
            ? null
            : ctx.platform
                .execCommand('git', ['--no-optional-locks', 'cat-file', 'commit', parsed.oid], { cwd, timeoutMs: GIT_TIMEOUT_MS })
                .then((r) => (r.code === 0 ? parseCommit(r.stdout) : null))
                .catch(() => null),
          mtimeOrNull(join(dirs.commonDir, 'FETCH_HEAD')),
          detectOperation(dirs.gitDir, exists),
        ]);
        return {
          state: 'ok',
          branch: parsed.branch,
          detachedAt: parsed.detachedAt,
          operation,
          upstream: parsed.upstream,
          ahead: parsed.ahead,
          behind: parsed.behind,
          lastFetchAt,
          changes: parsed.changes,
          files: parsed.files,
          lastCommit: lastCommit && parsed.oid ? { hash: parsed.oid.slice(0, 7), ...lastCommit } : null,
        };
      },

      async openFile(ctx, { path }) {
        const abs = resolveInside(ctx.project.path, path);
        const st = await stat(abs).catch(() => null);
        if (!st?.isFile()) throw new NestboxError('NOT_FOUND', 'That file no longer exists');
        await ctx.platform.openInEditor(abs);
      },
    },
    async dispose() {
      watcher.disposeAll();
    },
    forgetProject(rootId) {
      watcher.forgetRoot(rootId);
    },
  });
}
