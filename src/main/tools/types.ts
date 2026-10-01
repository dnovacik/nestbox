import type { z } from 'zod';
import type { DetectedProject } from '@shared/detected';
import type { ToolContract, ToolDefinition } from '@shared/tool';
import type { PlatformAdapter } from '../platform/adapter';
import type { SharedFacts } from './shared-context';

/** A tool's own slice of the root project's toolSettings. */
export interface ToolSettingsAccess<S> {
  /** Parsed with the tool's settingsSchema; invalid stored data falls back to the schema's defaults. */
  get(): S;
  /** Validates, persists on the root project and returns the stored value. Throws INTERNAL on a read-only store. */
  update(fn: (current: S) => S): S;
}

export interface ToolContext<S = unknown> {
  project: DetectedProject;
  shared: SharedFacts;
  emit(event: string, payload: unknown): void;
  platform: PlatformAdapter;
  settings: ToolSettingsAccess<S>;
}

export type ToolHandlers<C extends ToolContract, S = unknown> = {
  [K in keyof C]: (ctx: ToolContext<S>, input: z.output<C[K]['input']>) => Promise<z.input<C[K]['output']>>;
};

export interface MainTool<S, C extends ToolContract> extends ToolDefinition<S> {
  contract: C;
  handlers: ToolHandlers<C, S>;
  /** Start watchers. */
  activate?(ctx: ToolContext<S>): void;
  /** Kill processes, close servers. */
  dispose?(): Promise<void>;
  /** A root project (and its workspace packages) was removed: drop watchers and caches for it. */
  forgetProject?(rootId: string): void;
}

/** Type-erased tool for the host's dynamic dispatch. */
export interface AnyMainTool extends ToolDefinition<unknown> {
  contract: ToolContract;
  handlers: Record<string, (ctx: ToolContext, input: unknown) => Promise<unknown>>;
  activate?(ctx: ToolContext): void;
  dispose?(): Promise<void>;
  forgetProject?(rootId: string): void;
}

export function defineMainTool<S, C extends ToolContract>(tool: MainTool<S, C>): AnyMainTool {
  return tool as unknown as AnyMainTool;
}
