import { z } from 'zod';
import { LogLineSchema, LogSnapshotSchema } from '../../processes';
import { defineContract, defineEvents, type ToolDefinition } from '../../tool';
import { checkJsonBody } from './template';

/** Prism's default: clear of 3000, 4173 and 5173. */
export const DEFAULT_MOCK_PORT = 4010;
export const MAX_ROUTES = 100;
export const MAX_HEADERS = 20;
export const MAX_BODY_CHARS = 256 * 1024;
export const MAX_DELAY_MS = 10_000;
export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ANY'] as const;
export type MockMethod = (typeof METHODS)[number];

const StatusSchema = z.number().int().min(100).max(599);
const DelaySchema = z.number().int().min(0).max(MAX_DELAY_MS);
/** Set by the server itself: a route can't override them. */
const RESERVED_HEADERS = new Set([
  'content-length',
  'transfer-encoding',
  'connection',
  'x-nestbox-mock',
]);

/** "/users/:id/posts", "/files/*": segments, :name for one segment, * as the last one for the rest. */
export const PATH_PATTERN = /^\/(?:[^/\s?#*]+(?:\/[^/\s?#*]+)*(?:\/\*)?|\*)?\/?$/;
export const PathSchema = z
  .string()
  .max(500)
  .regex(PATH_PATTERN, 'A path like /users/:id (a * only as the last segment)');

export const HeaderSchema = z.object({
  name: z
    .string()
    .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/, 'Not a header name')
    .refine((n) => !RESERVED_HEADERS.has(n.toLowerCase()), 'NestBox sets this header itself'),
  value: z
    .string()
    .max(2_000)
    .regex(/^[^\r\n\0]*$/, 'No line breaks in a header value'),
});

export const FailSchema = z.object({
  on: z.boolean().default(false),
  status: StatusSchema.default(500),
});

export const RouteSchema = z
  .object({
    id: z.string().min(1).max(64),
    enabled: z.boolean().default(true),
    method: z.enum(METHODS),
    path: PathSchema,
    status: StatusSchema.default(200),
    contentType: z.enum(['json', 'text']).default('json'),
    headers: z.array(HeaderSchema).max(MAX_HEADERS).default([]),
    body: z.string().max(MAX_BODY_CHARS).default(''),
    delayMs: DelaySchema.default(0),
    fail: FailSchema.default({ on: false, status: 500 }),
  })
  .superRefine((route, ctx) => {
    if (route.contentType !== 'json') return;
    const problem = checkJsonBody(route.body);
    if (problem)
      ctx.addIssue({
        code: 'custom',
        path: ['body'],
        message: `The body isn't valid JSON: ${problem}`,
      });
  });
export type MockRoute = z.infer<typeof RouteSchema>;
export type MockRouteInput = z.input<typeof RouteSchema>;

export const PackageMockSchema = z.object({
  /** null: the first free port from DEFAULT_MOCK_PORT. */
  port: z.number().int().min(1).max(65_535).nullable().default(null),
  routes: z.array(RouteSchema).max(MAX_ROUTES).default([]),
  /** Added to every route's own delay. */
  delayMs: DelaySchema.default(0),
  /** Fail every request with this status. */
  failAll: FailSchema.default({ on: false, status: 500 }),
});
export type PackageMock = z.infer<typeof PackageMockSchema>;

const settingsSchema = z.object({
  /** By package relPath ('' = the root), like Static's servers. */
  packages: z.record(z.string(), PackageMockSchema).default({}),
});
export type MockSettings = z.infer<typeof settingsSchema>;

export const mockDefinition: ToolDefinition<MockSettings> = {
  id: 'mock',
  name: 'Mock API',
  icon: 'braces',
  appliesTo: () => true,
  settingsSchema,
};

export const MockStatusSchema = z.object({
  running: z.boolean(),
  port: z.number().int().nullable(),
  /** http://localhost:port while running. */
  url: z.string().nullable(),
  /** The server runs on another port than the configured one: restart to apply. */
  configChanged: z.boolean(),
  /** Requests answered since it started. */
  requests: z.number().int(),
});
export type MockStatus = z.infer<typeof MockStatusSchema>;

export const mockContract = defineContract({
  config: { input: z.strictObject({}), output: PackageMockSchema },
  /** Adds the route, or replaces the one with the same id. */
  saveRoute: { input: z.strictObject({ route: RouteSchema }), output: PackageMockSchema },
  deleteRoute: {
    input: z.strictObject({ id: z.string().min(1).max(64) }),
    output: PackageMockSchema,
  },
  /** Moves a route to index `to` (first match wins, so order matters). */
  moveRoute: {
    input: z.strictObject({ id: z.string().min(1).max(64), to: z.number().int().min(0) }),
    output: PackageMockSchema,
  },
  setOptions: {
    input: z.strictObject({
      port: z.number().int().min(1).max(65_535).nullable().optional(),
      delayMs: DelaySchema.optional(),
      failAll: z.strictObject({ on: z.boolean(), status: StatusSchema }).optional(),
    }),
    output: PackageMockSchema,
  },
  status: { input: z.strictObject({}), output: MockStatusSchema },
  start: { input: z.strictObject({}), output: MockStatusSchema },
  stop: { input: z.strictObject({}), output: MockStatusSchema },
  /** The first free port from the configured (or default) one; for "Use the next free port". */
  nextFreePort: { input: z.strictObject({}), output: z.object({ port: z.number().int() }) },
  getLogs: {
    input: z.strictObject({ afterSeq: z.number().int().nonnegative().optional() }),
    output: LogSnapshotSchema,
  },
  clearLogs: { input: z.strictObject({}), output: z.void() },
});

export const mockEvents = defineEvents({
  /** Started, stopped, or the config changed. */
  changed: z.undefined(),
  logs: z.object({ lines: z.array(LogLineSchema) }),
});
