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

/**
 * Resource usage for a set of processes (Nestbox-managed).
 */
export const ProcessStatsSchema = z.object({
  /** Total CPU usage percentage across all processes (0-100+) */
  cpuPercent: z.number().min(0),
  /** Total memory usage in bytes across all processes */
  memoryUsed: z.number().min(0),
});

export type ProcessStats = z.infer<typeof ProcessStatsSchema>;
