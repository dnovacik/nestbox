// The Dependencies tool: outdated and vulnerable dependencies through each package manager's own commands.
// The one tool that reaches the network (through the package manager), and only on Check or the user's
// schedule. Results are kept per package in the deps cache file; nothing here runs on its own.
import { type DetectedProject, workspaceId } from '@shared/detected';
import { NestboxError } from '@shared/errors';
import { belongsTo } from '@shared/processes';
import {
  depsContract,
  depsDefinition,
  type PackageResult,
  type Results,
} from '@shared/tools/deps/contract';
import type { Logger } from '../../logger';
import { type AnyMainTool, defineMainTool, type ToolContext } from '../types';
import type { DepsCache } from './cache';
import { checkPackage, updateCommand } from './check';
import { createRun } from './run';

export interface DepsToolDeps {
  logger: Logger;
  cache: DepsCache;
  /** Root project ids with a check running; shared with the Dependencies page. */
  running: Set<string>;
  clipboard: { writeText(text: string): void };
  now?: () => number;
}

type Ctx = ToolContext<Record<string, never>>;

/** The packages a check covers: a root and its workspace packages, or one package. */
const targetsOf = (project: DetectedProject): DetectedProject[] =>
  project.relPath === '' ? [project, ...project.workspaces] : [project];

export function createDepsTool(deps: DepsToolDeps): AnyMainTool {
  const now = deps.now ?? Date.now;

  function results(ctx: Ctx): Results {
    const packages = targetsOf(ctx.project)
      .map((p) => deps.cache.get(p.id))
      .filter((r): r is PackageResult => r !== undefined);
    return { packages, checking: deps.running.has(ctx.project.rootId) };
  }

  return defineMainTool({
    ...depsDefinition,
    contract: depsContract,
    handlers: {
      results: async (ctx: Ctx) => results(ctx),

      check: async (ctx: Ctx) => {
        const rootId = ctx.project.rootId;
        if (deps.running.has(rootId))
          throw new NestboxError('CONFLICT', 'A dependency check is already running');
        deps.running.add(rootId);
        ctx.emit('changed', undefined);
        try {
          // One package at a time: package managers share caches and lockfiles.
          for (const target of targetsOf(ctx.project)) {
            const started = now();
            const manager = target.packageManager ?? 'npm';
            const { flavour, rows, errors } = await checkPackage(
              target.path,
              manager,
              createRun(ctx.platform, target.path),
            );
            deps.cache.set({
              projectId: target.id,
              relPath: target.relPath,
              name: target.name,
              manager: flavour,
              checkedAt: now(),
              rows,
              errors,
            });
            deps.logger.info('deps check', {
              projectId: target.id,
              manager: flavour,
              rows: rows.length,
              outdated: rows.filter((r) => r.outdated).length,
              vulnerable: rows.filter((r) => r.advisories.length > 0).length,
              errors: errors.map((e) => `${e.step}:${e.code}`).join(',') || 'none',
              ms: now() - started,
            });
          }
        } finally {
          deps.running.delete(rootId);
          ctx.emit('changed', undefined);
        }
        return results(ctx);
      },

      copyUpdateCommand: async (ctx: Ctx, { relPath, name }) => {
        const id = relPath === '' ? ctx.project.rootId : workspaceId(ctx.project.rootId, relPath);
        const result = targetsOf(ctx.project).some((p) => p.id === id)
          ? deps.cache.get(id)
          : undefined;
        const row = result?.rows.find((r) => r.name === name && r.type !== null);
        if (!result || !row) throw new NestboxError('NOT_FOUND', 'Unknown dependency');
        const command = updateCommand(result.manager, row.name, row.type);
        deps.clipboard.writeText(command);
        return { command };
      },
    },
    forgetProject(rootId) {
      deps.cache.forget((id) => belongsTo(id, rootId));
    },
  });
}
