import { z } from 'zod';

export const PortOwnerSchema = z.object({ projectId: z.string().min(1), script: z.string().min(1) });

/** A listening TCP port, as the Ports page shows it. */
export const PortRowSchema = z.object({
  port: z.number().int().min(0).max(65_535),
  pid: z.number().int().nonnegative(),
  addresses: z.array(z.string()),
  processName: z.string().nullable(),
  /** Full command line, shown in the UI only (never logged or stored). */
  command: z.string().nullable(),
  /** The NestBox script that owns this port, when it is one of ours. */
  owner: PortOwnerSchema.nullable(),
});
export type PortRow = z.infer<typeof PortRowSchema>;

export const PortListSchema = z.object({
  rows: z.array(PortRowSchema),
  scannedAt: z.number(),
  /** The last scan failed; these rows are from the one before. */
  stale: z.boolean(),
});
export type PortList = z.infer<typeof PortListSchema>;

export const PortKillInputSchema = z.strictObject({
  pid: z.number().int().positive(),
  port: z.number().int().min(1).max(65_535),
  /** The user confirmed killing a process NestBox did not start. */
  confirmed: z.boolean(),
});
export type PortKillInput = z.infer<typeof PortKillInputSchema>;

export const PortKillResultSchema = z.object({
  result: z.enum(['stopped-script', 'killed', 'needs-confirm']),
  processName: z.string().nullable(),
});
export type PortKillResult = z.infer<typeof PortKillResultSchema>;

export const PortWaitInputSchema = z.strictObject({
  port: z.number().int().min(1).max(65_535),
  timeoutMs: z.number().int().min(0).max(30_000),
});
