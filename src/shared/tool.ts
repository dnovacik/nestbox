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
