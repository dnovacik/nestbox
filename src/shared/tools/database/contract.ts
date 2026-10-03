import { z } from 'zod';
import { LogLineSchema, LogSnapshotSchema } from '../../processes';
import { defineContract, defineEvents, type ToolDefinition } from '../../tool';

const settingsSchema = z.strictObject({});

export const databaseDefinition: ToolDefinition<z.infer<typeof settingsSchema>> = {
  id: 'database',
  name: 'Database',
  icon: 'database',
  // Reading .env to see whether DATABASE_URL is set is the tool's job, not detection's.
  appliesTo: (p) => p.prismaSchema !== null || p.envFiles.length > 0,
  settingsSchema,
};

/** Where the URL points, without the user, password or query string. Never the raw value. */
export const DbTargetSchema = z.object({
  provider: z.string(),
  host: z.string().nullable(),
  port: z.number().int().nullable(),
  database: z.string().nullable(),
  /** SQLite: the database file. */
  file: z.string().nullable(),
  source: z.enum(['.env', 'prisma/.env']),
});
export type DbTargetView = z.infer<typeof DbTargetSchema>;

export const REACH_RESULTS = ['reachable', 'refused', 'timeout', 'dns', 'missing-file', 'not-checked'] as const;
export const PRISMA_COMMANDS = ['migrate-status', 'generate'] as const;
export type PrismaCommand = (typeof PRISMA_COMMANDS)[number];

export const DbStatusSchema = z.object({
  /** The schema path relative to the package, when there is one. */
  prisma: z.object({ schema: z.string() }).nullable(),
  /** DATABASE_URL, or the schema's env("…") name. */
  variable: z.string(),
  url: z.discriminatedUnion('state', [
    z.object({ state: z.literal('set'), target: DbTargetSchema }),
    /** configTs: a prisma.config.ts exists, which may set the URL (it is never executed). */
    z.object({ state: z.literal('missing'), configTs: z.boolean() }),
    /** url = "…" written in the schema itself. */
    z.object({ state: z.literal('literal') }),
  ]),
  reach: z.object({ result: z.enum(REACH_RESULTS), reason: z.string().nullable() }).nullable(),
  running: z.object({
    command: z.enum([...PRISMA_COMMANDS, 'test-login']).nullable(),
    studio: z.object({ port: z.number().int() }).nullable(),
  }),
});
export type DbStatus = z.infer<typeof DbStatusSchema>;

export const databaseContract = defineContract({
  status: { input: z.strictObject({}), output: DbStatusSchema },
  /** Runs SELECT 1 through Prisma; message is NestBox's own text for the P-code, never Prisma's. */
  testLogin: { input: z.strictObject({}), output: z.object({ ok: z.boolean(), message: z.string() }) },
  run: { input: z.strictObject({ command: z.enum(PRISMA_COMMANDS) }), output: z.void() },
  stop: { input: z.strictObject({ what: z.enum(['command', 'studio']) }), output: z.void() },
  /** Opens a terminal: migrate dev asks for a name and may ask to reset the database. */
  migrateDev: { input: z.strictObject({}), output: z.void() },
  startStudio: { input: z.strictObject({}), output: z.object({ port: z.number().int() }) },
  getLogs: { input: z.strictObject({ afterSeq: z.number().int().nonnegative().optional() }), output: LogSnapshotSchema },
  clearLogs: { input: z.strictObject({}), output: z.void() },
});

export const databaseEvents = defineEvents({
  /** A command or Studio started or stopped. */
  changed: z.undefined(),
  logs: z.object({ lines: z.array(LogLineSchema) }),
});
