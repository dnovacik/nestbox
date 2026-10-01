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
  /** Throws NestboxError NOT_FOUND for unknown ids. */
  getProject(projectId: string): DetectedProject;
  shared: SharedContext;
  platform: PlatformAdapter;
  emit(payload: ToolEventPayload): void;
  logger: Logger;
}

export interface ToolHost {
  list(projectId: string): ToolSummary[];
  invoke(toolId: string, projectId: string, method: string, input: unknown): Promise<unknown>;
  disposeAll(): Promise<void>;
}

export function createToolHost(deps: ToolHostDeps): ToolHost {
  const byId = new Map(deps.tools.map((tool) => [tool.id, tool]));

  function context(tool: AnyMainTool, project: DetectedProject): ToolContext {
    return {
      project,
      shared: deps.shared.forProject(project.id),
      emit: (event, payload) => deps.emit({ toolId: tool.id, projectId: project.id, event, payload }),
      platform: deps.platform,
    };
  }

  return {
    list(projectId) {
      const project = deps.getProject(projectId);
      return deps.tools
        .filter((tool) => tool.appliesTo(project))
        .map(({ id, name, icon }) => ({ id, name, icon }));
    },

    async invoke(toolId, projectId, method, input) {
      const tool = byId.get(toolId);
      if (!tool) throw new NestboxError('NOT_FOUND', `Unknown tool: ${toolId}`);
      const project = deps.getProject(projectId);
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

    async disposeAll() {
      await Promise.allSettled(deps.tools.map((tool) => tool.dispose?.()));
    },
  };
}
