import type { DetectedProject } from '@shared/detected';
import { describeIssues, NestboxError } from '@shared/errors';
import type { ToolSummary } from '@shared/tool';
import type { Logger } from '../logger';
import type { PlatformAdapter } from '../platform/adapter';
import type { SharedContext } from './shared-context';
import type { AnyMainTool, ToolContext } from './types';

export interface ToolEventPayload {
  toolId: string;
  projectId: string;
  event: string;
  payload: unknown;
}

export interface ToolHostDeps {
  tools: readonly AnyMainTool[];
  /** Throws (or rejects with) NestboxError NOT_FOUND for unknown ids; may wait for a detection in flight. */
  getProject(projectId: string): DetectedProject | Promise<DetectedProject>;
  shared: SharedContext;
  platform: PlatformAdapter;
  emit(payload: ToolEventPayload): void;
  logger: Logger;
  /** Raw per-tool settings on a root project (Project.toolSettings[toolId]). */
  toolSettings: {
    get(rootId: string, toolId: string): unknown;
    set(rootId: string, toolId: string, value: unknown): void;
  };
  /** Settings → Tools: a turned-off tool is not listed and refuses calls (all on when omitted). */
  isEnabled?(toolId: string): boolean;
}

export interface DisposeResult {
  failed: string[];
  timedOut: string[];
}

export interface ToolHost {
  list(projectId: string): Promise<ToolSummary[]>;
  invoke(toolId: string, projectId: string, method: string, input: unknown): Promise<unknown>;
  /** Disposes every tool in parallel; a tool that rejects or outlasts the timeout is logged by id. */
  disposeAll(timeoutMs?: number): Promise<DisposeResult>;
  /** After a root project is removed: tools drop what they hold for it, and its shared facts go. */
  forgetProject(rootId: string): void;
  /** A tool was turned off: it lets go of every root project (servers, followers, watchers stop). */
  deactivate(toolId: string, rootIds: readonly string[]): void;
  /** Tools with something running now. */
  busyTools(): string[];
}

const DEFAULT_DISPOSE_TIMEOUT_MS = 4_500;

export function createToolHost(deps: ToolHostDeps): ToolHost {
  const byId = new Map(deps.tools.map((tool) => [tool.id, tool]));
  const isEnabled = (toolId: string) => deps.isEnabled?.(toolId) ?? true;

  function settingsFor(tool: AnyMainTool, project: DetectedProject): ToolContext['settings'] {
    const get = (): unknown => {
      const stored = deps.toolSettings.get(project.rootId, tool.id);
      const parsed = tool.settingsSchema.safeParse(stored ?? {});
      if (parsed.success) return parsed.data;
      deps.logger.warn('tool settings invalid, using defaults', { toolId: tool.id });
      return tool.settingsSchema.parse({});
    };
    return {
      get,
      update(fn) {
        const next = tool.settingsSchema.parse(fn(get()));
        deps.toolSettings.set(project.rootId, tool.id, next);
        return next;
      },
    };
  }

  function context(tool: AnyMainTool, project: DetectedProject): ToolContext {
    return {
      project,
      shared: deps.shared.forProject(project.id),
      emit: (event, payload) => deps.emit({ toolId: tool.id, projectId: project.id, event, payload }),
      platform: deps.platform,
      settings: settingsFor(tool, project),
    };
  }

  return {
    async list(projectId) {
      const project = await deps.getProject(projectId);
      return deps.tools
        .filter((tool) => isEnabled(tool.id) && tool.appliesTo(project))
        .map(({ id, name, icon }) => ({ id, name, icon }));
    },

    async invoke(toolId, projectId, method, input) {
      const tool = byId.get(toolId);
      if (!tool) throw new NestboxError('NOT_FOUND', `Unknown tool: ${toolId}`);
      if (!isEnabled(toolId)) throw new NestboxError('NOT_FOUND', `Tool ${toolId} is turned off`);
      const project = await deps.getProject(projectId);
      if (!tool.appliesTo(project)) {
        throw new NestboxError('NOT_FOUND', `Tool ${toolId} does not apply to this project`);
      }
      const spec = Object.hasOwn(tool.contract, method) ? tool.contract[method] : undefined;
      const handler = Object.hasOwn(tool.handlers, method) ? tool.handlers[method] : undefined;
      if (!spec || !handler) throw new NestboxError('NOT_FOUND', `Unknown method: ${toolId}.${method}`);

      const parsed = spec.input.safeParse(input);
      if (!parsed.success) {
        throw new NestboxError('VALIDATION', `Invalid input for ${toolId}.${method}: ${describeIssues(parsed.error)}`);
      }
      const result = await handler(context(tool, project), parsed.data);
      const output = spec.output.safeParse(result);
      if (!output.success) {
        deps.logger.error('tool returned invalid output', { toolId, method });
        throw new NestboxError('INTERNAL', `${toolId}.${method} returned invalid output`);
      }
      return output.data;
    },

    deactivate(toolId, rootIds) {
      const tool = byId.get(toolId);
      for (const rootId of rootIds) {
        try {
          tool?.forgetProject?.(rootId);
        } catch {
          deps.logger.warn('tool deactivate failed', { toolId });
        }
      }
    },

    busyTools() {
      return deps.tools.filter((tool) => tool.busy?.() === true).map((tool) => tool.id);
    },

    forgetProject(rootId) {
      for (const tool of deps.tools) {
        try {
          tool.forgetProject?.(rootId);
        } catch {
          deps.logger.warn('tool forgetProject failed', { toolId: tool.id });
        }
      }
      deps.shared.clearProject(rootId);
    },

    async disposeAll(timeoutMs = DEFAULT_DISPOSE_TIMEOUT_MS) {
      const result: DisposeResult = { failed: [], timedOut: [] };
      await Promise.all(
        deps.tools.map(async (tool) => {
          if (!tool.dispose) return;
          let timer: ReturnType<typeof setTimeout> | undefined;
          const timeout = new Promise<'timeout'>((resolve) => {
            timer = setTimeout(() => resolve('timeout'), timeoutMs);
          });
          const dispose = tool.dispose.bind(tool);
          const outcome = await Promise.race([
            Promise.resolve()
              .then(dispose)
              .then(
              () => 'ok' as const,
              () => 'failed' as const,
            ),
            timeout,
          ]);
          clearTimeout(timer);
          if (outcome === 'failed') {
            result.failed.push(tool.id);
            deps.logger.warn('tool dispose failed', { toolId: tool.id });
          } else if (outcome === 'timeout') {
            result.timedOut.push(tool.id);
            deps.logger.warn('tool dispose timed out', { toolId: tool.id });
          }
        }),
      );
      return result;
    },
  };
}
