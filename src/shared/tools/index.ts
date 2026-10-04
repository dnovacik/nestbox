import type { z } from 'zod';
import type { ToolDefinition, ToolEvents } from '../tool';
import { claudeContract, claudeDefinition, claudeEvents } from './claude/contract';
import { composeContract, composeDefinition, composeEvents } from './compose/contract';
import { databaseContract, databaseDefinition, databaseEvents } from './database/contract';
import { deployContract, deployDefinition, deployEvents } from './deploy/contract';
import { depsContract, depsDefinition, depsEvents } from './deps/contract';
import { envContract, envDefinition, envEvents } from './env/contract';
import { gitContract, gitDefinition, gitEvents } from './git/contract';
import { healthContract, healthDefinition, healthEvents } from './health/contract';
import { inspectorContract, inspectorDefinition, inspectorEvents } from './inspector/contract';
import { mockContract, mockDefinition, mockEvents } from './mock/contract';
import { nodeContract, nodeDefinition } from './node/contract';
import { projectInfoContract, projectInfoDefinition } from './project-info/contract';
import { scriptsContract, scriptsDefinition, scriptsEvents } from './scripts/contract';
import { staticContract, staticDefinition, staticEvents } from './static/contract';
import { todosContract, todosDefinition } from './todos/contract';

/** Tool registry, shared half. Adding a tool = one line here, one in main/tools, one in renderer/tools. */
export const toolContracts = {
  'project-info': projectInfoContract,
  scripts: scriptsContract,
  env: envContract,
  static: staticContract,
  claude: claudeContract,
  git: gitContract,
  database: databaseContract,
  todos: todosContract,
  health: healthContract,
  compose: composeContract,
  mock: mockContract,
  inspector: inspectorContract,
  node: nodeContract,
  deps: depsContract,
  deploy: deployContract,
} as const;

export const toolDefinitions: readonly ToolDefinition<unknown>[] = [
  projectInfoDefinition,
  scriptsDefinition as ToolDefinition<unknown>,
  envDefinition as ToolDefinition<unknown>,
  staticDefinition as ToolDefinition<unknown>,
  claudeDefinition as ToolDefinition<unknown>,
  gitDefinition as ToolDefinition<unknown>,
  databaseDefinition as ToolDefinition<unknown>,
  todosDefinition as ToolDefinition<unknown>,
  healthDefinition as ToolDefinition<unknown>,
  composeDefinition as ToolDefinition<unknown>,
  mockDefinition as ToolDefinition<unknown>,
  inspectorDefinition as ToolDefinition<unknown>,
  nodeDefinition as ToolDefinition<unknown>,
  depsDefinition as ToolDefinition<unknown>,
  deployDefinition as ToolDefinition<unknown>,
];

export type ToolId = keyof typeof toolContracts;

/** The core: never turned off, whatever the stored list says. */
export const ALWAYS_ON_TOOLS: readonly string[] = ['project-info', 'scripts'];
/** The tools Settings → Tools and the first-run picker offer, in registry order. */
export const TOGGLEABLE_TOOLS = toolDefinitions
  .filter((d) => !ALWAYS_ON_TOOLS.includes(d.id))
  .map(({ id, name, icon }) => ({ id, name, icon }));
/** The first-run picker's "Essentials" preset. */
export const ESSENTIAL_TOOLS: readonly string[] = ['env', 'claude', 'git', 'node', 'deps'];

export function isToolEnabled(disabledTools: readonly string[], toolId: string): boolean {
  return ALWAYS_ON_TOOLS.includes(toolId) || !disabledTools.includes(toolId);
}
export type ToolMethodName<T extends ToolId> = keyof (typeof toolContracts)[T] & string;
type MethodSpec<T extends ToolId, M extends ToolMethodName<T>> = (typeof toolContracts)[T][M] & {
  input: z.ZodType;
  output: z.ZodType;
};
export type ToolMethodInput<T extends ToolId, M extends ToolMethodName<T>> = z.input<MethodSpec<T, M>['input']>;
export type ToolMethodOutput<T extends ToolId, M extends ToolMethodName<T>> = z.output<MethodSpec<T, M>['output']>;

/** Event payload schemas per tool. A tool without events maps to {}. */
export const toolEvents = {
  'project-info': {},
  scripts: scriptsEvents,
  env: envEvents,
  static: staticEvents,
  claude: claudeEvents,
  git: gitEvents,
  database: databaseEvents,
  todos: {},
  health: healthEvents,
  compose: composeEvents,
  mock: mockEvents,
  inspector: inspectorEvents,
  node: {},
  deps: depsEvents,
  deploy: deployEvents,
} as const satisfies Record<ToolId, ToolEvents>;

export type ToolEventName<T extends ToolId> = keyof (typeof toolEvents)[T] & string;
export type ToolEventPayload<T extends ToolId, E extends ToolEventName<T>> = z.output<
  (typeof toolEvents)[T][E] & z.ZodType
>;
