import type { z } from 'zod';
import type { ToolDefinition, ToolEvents } from '../tool';
import { claudeContract, claudeDefinition, claudeEvents } from './claude/contract';
import { envContract, envDefinition, envEvents } from './env/contract';
import { projectInfoContract, projectInfoDefinition } from './project-info/contract';
import { scriptsContract, scriptsDefinition, scriptsEvents } from './scripts/contract';
import { staticContract, staticDefinition, staticEvents } from './static/contract';

/** Tool registry, shared half. Adding a tool = one line here, one in main/tools, one in renderer/tools. */
export const toolContracts = {
  'project-info': projectInfoContract,
  scripts: scriptsContract,
  env: envContract,
  static: staticContract,
  claude: claudeContract,
} as const;

export const toolDefinitions: readonly ToolDefinition<unknown>[] = [
  projectInfoDefinition,
  scriptsDefinition as ToolDefinition<unknown>,
  envDefinition as ToolDefinition<unknown>,
  staticDefinition as ToolDefinition<unknown>,
  claudeDefinition as ToolDefinition<unknown>,
];

export type ToolId = keyof typeof toolContracts;
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
} as const satisfies Record<ToolId, ToolEvents>;

export type ToolEventName<T extends ToolId> = keyof (typeof toolEvents)[T] & string;
export type ToolEventPayload<T extends ToolId, E extends ToolEventName<T>> = z.output<
  (typeof toolEvents)[T][E] & z.ZodType
>;
