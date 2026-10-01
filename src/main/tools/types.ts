import type { z } from 'zod';
import type { DetectedProject } from '@shared/detected';
import type { ToolContract, ToolDefinition } from '@shared/tool';
import type { PlatformAdapter } from '../platform/adapter';
import type { SharedFacts } from './shared-context';

export interface ToolContext {
  project: DetectedProject;
  shared: SharedFacts;
  emit(event: string, payload: unknown): void;
  platform: PlatformAdapter;
}

export type ToolHandlers<C extends ToolContract> = {
  [K in keyof C]: (ctx: ToolContext, input: z.output<C[K]['input']>) => Promise<z.input<C[K]['output']>>;
};

export interface MainTool<S, C extends ToolContract> extends ToolDefinition<S> {
  contract: C;
  handlers: ToolHandlers<C>;
  /** Start watchers. */
  activate?(ctx: ToolContext): void;
  /** Kill processes, close servers. */
  dispose?(): Promise<void>;
}

/** Type-erased tool for the host's dynamic dispatch. */
export interface AnyMainTool extends ToolDefinition<unknown> {
  contract: ToolContract;
  handlers: Record<string, (ctx: ToolContext, input: unknown) => Promise<unknown>>;
  activate?(ctx: ToolContext): void;
  dispose?(): Promise<void>;
}

export function defineMainTool<S, C extends ToolContract>(tool: MainTool<S, C>): AnyMainTool {
  return tool as unknown as AnyMainTool;
}
