import { z } from 'zod';
import { defineContract, defineEvents, type ToolDefinition } from '../../tool';

/** Clear of 3000, 4010 (mock API), 4173 (static) and 5173. */
export const DEFAULT_INSPECTOR_PORT = 4020;
export const MAX_ENTRIES = 200;
/** Each recorded body keeps at most this much (the proxied body itself is passed through whole). */
export const CAPTURE_BYTES = 256 * 1024;
export const MAX_REQUEST_BYTES = 10 * 1024 * 1024;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLocalApiUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      LOCAL_HOSTS.has(url.hostname) &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
}

/** The API the inspector forwards to: this machine only, no credentials, query or fragment. */
export const LocalUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine(isLocalApiUrl, 'A local address like http://localhost:3000 (no user, password or query)');

const PortSchema = z.number().int().min(1).max(65_535);

export const PackageInspectorSchema = z.object({
  /** null: the first free port from DEFAULT_INSPECTOR_PORT. */
  port: PortSchema.nullable().default(null),
  /** null: http://localhost:<PORT from .env>. */
  target: LocalUrlSchema.nullable().default(null),
});
export type PackageInspector = z.infer<typeof PackageInspectorSchema>;

const settingsSchema = z.object({
  packages: z.record(z.string(), PackageInspectorSchema).default({}),
});
export type InspectorSettings = z.infer<typeof settingsSchema>;

export const inspectorDefinition: ToolDefinition<InspectorSettings> = {
  id: 'inspector',
  name: 'Inspector',
  icon: 'radar',
  appliesTo: () => true,
  settingsSchema,
};

export const InspectorStatusSchema = z.object({
  running: z.boolean(),
  port: z.number().int().nullable(),
  /** http://localhost:port while running. */
  url: z.string().nullable(),
  /** Where requests go; null when there is neither a setting nor a PORT in .env. */
  target: z.string().nullable(),
  targetSource: z.enum(['setting', 'env']).nullable(),
  /** Running with another port or target than configured: restart to apply. */
  configChanged: z.boolean(),
  count: z.number().int(),
});
export type InspectorStatus = z.infer<typeof InspectorStatusSchema>;

export const EntrySummarySchema = z.object({
  id: z.string(),
  at: z.number(),
  method: z.string(),
  /** Path and query, as requested. */
  path: z.string(),
  status: z.number().int().nullable(),
  ms: z.number().nullable(),
  reqBytes: z.number().int(),
  resBytes: z.number().int(),
  replayOf: z.string().nullable(),
  /** A code: ECONNREFUSED, timeout, too-large, upgrade. */
  error: z.string().nullable(),
});
export type EntrySummary = z.infer<typeof EntrySummarySchema>;

export const HeaderViewSchema = z.object({
  name: z.string(),
  value: z.string(),
  masked: z.boolean(),
});
export type HeaderView = z.infer<typeof HeaderViewSchema>;

export const BodyViewSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({
    kind: z.literal('text'),
    text: z.string(),
    truncated: z.boolean(),
    contentType: z.string().nullable(),
  }),
  z.object({ kind: z.literal('binary'), bytes: z.number().int(), truncated: z.boolean() }),
]);
export type BodyView = z.infer<typeof BodyViewSchema>;

export const SideViewSchema = z.object({
  headers: z.array(HeaderViewSchema),
  body: BodyViewSchema,
});
export type SideView = z.infer<typeof SideViewSchema>;

export const EntryDetailSchema = z.object({
  summary: EntrySummarySchema,
  request: SideViewSchema,
  response: SideViewSchema.nullable(),
});
export type EntryDetail = z.infer<typeof EntryDetailSchema>;

const HeaderNameSchema = z
  .string()
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/, 'Not a header name');
const SendHeaderSchema = z.union([
  z.strictObject({
    name: HeaderNameSchema,
    value: z
      .string()
      .max(8_000)
      .regex(/^[^\r\n\0]*$/, 'No line breaks in a header value'),
  }),
  /** Use the recorded value (a masked header the user didn't change). */
  z.strictObject({ name: HeaderNameSchema, keep: z.literal(true) }),
]);
export type SendHeader = z.infer<typeof SendHeaderSchema>;

export const SendInputSchema = z.strictObject({
  /** The entry the request was edited from. */
  from: z.string().min(1).max(64),
  method: z.string().regex(/^[A-Z]{1,16}$/, 'A method like GET or POST'),
  /** Path and query, starting with /. */
  path: z
    .string()
    .max(8_000)
    .regex(/^\/[^\s]*$/, 'A path starting with /, without spaces'),
  headers: z.array(SendHeaderSchema).max(100),
  body: z.string().max(1024 * 1024),
});
export type SendInput = z.infer<typeof SendInputSchema>;

const IdSchema = z.strictObject({ id: z.string().min(1).max(64) });

export const inspectorContract = defineContract({
  config: { input: z.strictObject({}), output: PackageInspectorSchema },
  setOptions: {
    input: z.strictObject({
      port: PortSchema.nullable().optional(),
      target: LocalUrlSchema.nullable().optional(),
    }),
    output: PackageInspectorSchema,
  },
  status: { input: z.strictObject({}), output: InspectorStatusSchema },
  start: { input: z.strictObject({}), output: InspectorStatusSchema },
  stop: { input: z.strictObject({}), output: InspectorStatusSchema },
  nextFreePort: { input: z.strictObject({}), output: z.object({ port: z.number().int() }) },
  /** Newest first. */
  list: { input: z.strictObject({}), output: z.array(EntrySummarySchema) },
  get: { input: IdSchema, output: EntryDetailSchema },
  /** One masked header value, like the env tool's reveal. */
  reveal: {
    input: z.strictObject({
      id: z.string().min(1).max(64),
      side: z.enum(['request', 'response']),
      name: z.string().min(1).max(100),
    }),
    output: z.object({ value: z.string() }),
  },
  replay: { input: IdSchema, output: z.object({ id: z.string() }) },
  send: { input: SendInputSchema, output: z.object({ id: z.string() }) },
  /** Writes a curl command to the clipboard from main. */
  copyCurl: { input: IdSchema, output: z.void() },
  clear: { input: z.strictObject({}), output: z.void() },
});

export const inspectorEvents = defineEvents({
  /** Started, stopped, or the settings changed. */
  changed: z.undefined(),
  /** Entries were added or cleared. */
  entries: z.undefined(),
});
