import { z } from 'zod';

export const ToolSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** lucide icon name, e.g. 'info'. */
  icon: z.string().min(1),
});
export type ToolSummary = z.infer<typeof ToolSummarySchema>;
