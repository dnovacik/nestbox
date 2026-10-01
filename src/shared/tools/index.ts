import type { z } from 'zod';
import type { ToolDefinition } from '../tool';
import { projectInfoContract, projectInfoDefinition } from './project-info/contract';

/** Tool registry, shared half. Adding a tool = one line here, one in main/tools, one in renderer/tools. */
export const toolContracts = {
  'project-info': projectInfoContract,
} as const;

export const toolDefinitions: readonly ToolDefinition<unknown>[] = [projectInfoDefinition];

export type ToolId = keyof typeof toolContracts;
export type ToolMethodName<T extends ToolId> = keyof (typeof toolContracts)[T] & string;
type MethodSpec<T extends ToolId, M extends ToolMethodName<T>> = (typeof toolContracts)[T][M] & {
  input: z.ZodType;
  output: z.ZodType;
};
export type ToolMethodInput<T extends ToolId, M extends ToolMethodName<T>> = z.input<MethodSpec<T, M>['input']>;
export type ToolMethodOutput<T extends ToolId, M extends ToolMethodName<T>> = z.output<MethodSpec<T, M>['output']>;
