import { z } from 'zod';
import { LogLineSchema, LogSnapshotSchema } from '../../processes';
import { defineContract, defineEvents, type ToolDefinition } from '../../tool';

export const MAX_LATENCY_MS = 5_000;
/** Vite's preview port: never the dev server's 3000 or 5173. */
export const DEFAULT_STATIC_PORT = 4173;

/** One package's server. null folder/port: the defaults (the build output; the first free port from 4173). */
export const ServerConfigSchema = z.object({
  /** Absolute, or relative to the package folder. */
  folder: z.string().min(1).max(4096).nullable().default(null),
  port: z.number().int().min(1).max(65_535).nullable().default(null),
  spa: z.boolean().default(true),
  https: z.boolean().default(false),
  /** Bind 0.0.0.0 and show the LAN URLs; otherwise 127.0.0.1 only. */
  lan: z.boolean().default(false),
  cors: z.boolean().default(false),
  noCache: z.boolean().default(true),
  latencyMs: z.number().int().min(0).max(MAX_LATENCY_MS).default(0),
});
export type ServerConfig = z.infer<typeof ServerConfigSchema>;

const settingsSchema = z.object({
  /** By package relPath ('' = the root). */
  servers: z.record(z.string(), ServerConfigSchema).default({}),
});
export type StaticSettings = z.infer<typeof settingsSchema>;

export const staticDefinition: ToolDefinition<StaticSettings> = {
  id: 'static',
  name: 'Static',
  icon: 'server',
  appliesTo: () => true,
  settingsSchema,
};

export const ServerStatusSchema = z.object({
  running: z.boolean(),
  /** The folder actually served (absolute), for display. */
  folder: z.string(),
  port: z.number().int().nullable(),
  /** http(s)://localhost:port/ while running. */
  localUrl: z.string().nullable(),
  /** One per LAN IPv4 address while running with lan on. */
  lanUrls: z.array(z.string()),
  /** The running server was started with a different config: restart to apply. */
  configChanged: z.boolean(),
  /** The folder served is the package folder itself (source files are exposed). */
  servesPackageRoot: z.boolean(),
});
export type ServerStatus = z.infer<typeof ServerStatusSchema>;

export const RunningServerSchema = z.object({ projectId: z.string(), url: z.string() });

export const staticContract = defineContract({
  config: { input: z.strictObject({}), output: ServerConfigSchema },
  setConfig: { input: z.strictObject({ config: ServerConfigSchema }), output: ServerConfigSchema },
  status: { input: z.strictObject({}), output: ServerStatusSchema },
  start: { input: z.strictObject({}), output: ServerStatusSchema },
  stop: { input: z.strictObject({}), output: ServerStatusSchema },
  /** Every running server, across projects. */
  running: { input: z.strictObject({}), output: z.array(RunningServerSchema) },
  /** The first free port from the configured (or default) one; for "Use the next free port". */
  nextFreePort: { input: z.strictObject({}), output: z.object({ port: z.number().int() }) },
  /** Native folder picker; null when cancelled. Stored relative when it is inside the package. */
  pickFolder: { input: z.strictObject({}), output: z.object({ folder: z.string().nullable() }) },
  getLogs: { input: z.strictObject({ afterSeq: z.number().int().nonnegative().optional() }), output: LogSnapshotSchema },
  clearLogs: { input: z.strictObject({}), output: z.void() },
});

export const staticEvents = defineEvents({
  logs: z.object({ lines: z.array(LogLineSchema) }),
  /** Started or stopped (status changed). */
  changed: z.undefined(),
});
