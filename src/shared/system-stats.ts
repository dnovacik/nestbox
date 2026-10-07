import { z } from 'zod';

/**
 * System resource usage statistics.
 */
export const SystemStatsSchema = z.object({
  /** CPU usage percentage (0-100) */
  cpuPercent: z.number().min(0).max(100),
  /** Memory usage in bytes */
  memoryUsed: z.number().min(0),
  /** Total memory in bytes */
  memoryTotal: z.number().min(0),
});

export type SystemStats = z.infer<typeof SystemStatsSchema>;
