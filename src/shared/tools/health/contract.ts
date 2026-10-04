import { z } from 'zod';
import { defineContract, defineEvents, type ToolDefinition } from '../../tool';

function isPlainHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.username === '' && url.password === '' && url.hostname !== '';
  } catch {
    return false;
  }
}

/** http(s) only, and never with credentials in it (those would be stored and shown as typed). */
export const HttpUrlSchema = z.string().trim().max(2000).refine(isPlainHttpUrl, { message: 'An http(s) URL without a user or password' });
export const StatusSchema = z.number().int().min(100).max(599);
/** The env keys the env tool calls URL-like (DATABASE_URL is the database tool's). */
export const UrlKeySchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*_(URL|URI)$/).max(200);
export const PathSchema = z.string().max(500).regex(/^\/\S*$/);

export const CheckInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('url'), url: HttpUrlSchema, expect: StatusSchema.optional() }),
  z.strictObject({ kind: z.literal('env'), key: UrlKeySchema, path: PathSchema.default('/'), expect: StatusSchema.optional() }),
]);
export type CheckInput = z.input<typeof CheckInputSchema>;

const StoredCheckSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.string().min(1).max(64), kind: z.literal('url'), url: HttpUrlSchema, expect: StatusSchema.optional() }),
  z.object({ id: z.string().min(1).max(64), kind: z.literal('env'), key: UrlKeySchema, path: PathSchema.default('/'), expect: StatusSchema.optional() }),
]);
export type StoredCheck = z.infer<typeof StoredCheckSchema>;

export const MAX_CHECKS = 20;

const PackageSettingsSchema = z.object({
  checks: z.array(StoredCheckSchema).max(MAX_CHECKS).default([]),
  intervalSec: z.number().int().min(5).max(600).default(30),
});
export type PackageSettings = z.infer<typeof PackageSettingsSchema>;

const settingsSchema = z.object({
  /** By package relPath ('' for the root), like the static tool's servers. */
  packages: z.record(z.string(), PackageSettingsSchema).default({}),
  notify: z.boolean().default(true),
});
export type HealthSettings = z.infer<typeof settingsSchema>;

export const healthDefinition: ToolDefinition<HealthSettings> = {
  id: 'health',
  name: 'Health',
  icon: 'heart-pulse',
  appliesTo: () => true,
  settingsSchema,
};

export const CHECK_STATES = ['ok', 'fail', 'config', 'idle'] as const;

export const CheckResultSchema = z.object({
  state: z.enum(CHECK_STATES),
  status: z.number().int().nullable(),
  ms: z.number().nullable(),
  /** A code (ECONNREFUSED, timeout, status 500, TLS) or a config reason; never the URL. */
  reason: z.string().nullable(),
  at: z.number(),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const CheckViewSchema = z.object({
  id: z.string(),
  kind: z.enum(['url', 'env']),
  /** The URL as typed, or "API_URL · host:port/path" (never an env value). */
  label: z.string(),
  expect: z.number().int().nullable(),
  result: CheckResultSchema.nullable(),
});
export type CheckView = z.infer<typeof CheckViewSchema>;

export const HealthStatusSchema = z.object({
  /** A script of this package is running, so its checks run. */
  live: z.boolean(),
  intervalSec: z.number().int(),
  notify: z.boolean(),
  checks: z.array(CheckViewSchema),
  suggestions: z.object({ port: z.number().int().nullable(), envKeys: z.array(z.string()) }),
});
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

export const healthContract = defineContract({
  status: { input: z.strictObject({}), output: HealthStatusSchema },
  addCheck: { input: z.strictObject({ check: CheckInputSchema }), output: z.void() },
  removeCheck: { input: z.strictObject({ id: z.string().min(1).max(64) }), output: z.void() },
  setOptions: {
    input: z.strictObject({ intervalSec: z.number().int().min(5).max(600).optional(), notify: z.boolean().optional() }),
    output: z.void(),
  },
  /** Runs the package's checks now, whether or not a script runs. */
  checkNow: { input: z.strictObject({}), output: z.void() },
});

export const healthEvents = defineEvents({
  /** Results or the live state changed. */
  changed: z.undefined(),
});
