import { z } from 'zod';
import type { DetectedProject } from './detected';

export const ToolSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** lucide icon name, e.g. 'info'. */
  icon: z.string().min(1),
});
export type ToolSummary = z.infer<typeof ToolSummarySchema>;

export interface ToolDefinition<S> {
  /** 'project-info', later 'scripts', 'ports', 'env', 'static', 'claude'. */
  id: string;
  name: string;
  /** lucide icon name. */
  icon: string;
  appliesTo(project: DetectedProject): boolean;
  settingsSchema: z.ZodType<S>;
}

export interface ToolMethod {
  input: z.ZodType;
  output: z.ZodType;
}

export type ToolContract = Record<string, ToolMethod>;

export function defineContract<C extends ToolContract>(contract: C): C {
  return contract;
}

/** Event payload schemas a tool may emit over tools:event, by event name. */
export type ToolEvents = Record<string, z.ZodType>;

export function defineEvents<E extends ToolEvents>(events: E): E {
  return events;
}

/** The tools:event envelope (main → renderer); the payload is checked against the tool's event schema. */
export const ToolEventEnvelopeSchema = z.object({
  toolId: z.string(),
  projectId: z.string(),
  event: z.string(),
  payload: z.unknown(),
});
