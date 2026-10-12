import { z } from 'zod';
import { LogLineSchema, LogSnapshotSchema } from '../../processes';
import { defineContract, defineEvents, type ToolDefinition } from '../../tool';
import { ENVIRONMENT_NAME } from '../env/contract';

const settingsSchema = z.strictObject({});

export const databaseDefinition: ToolDefinition<z.infer<typeof settingsSchema>> = {
  id: 'database',
  name: 'Database',
  icon: 'database',
  // Reading .env to see whether DATABASE_URL is set is the tool's job, not detection's; so is reading a
  // .NET project's appsettings for ConnectionStrings.
  appliesTo: (p) =>
    p.prismaSchema !== null ||
    p.envFiles.length > 0 ||
    p.ecosystems.some((e) => e.id === 'dotnet' && typeof (e.info as { project?: unknown } | null)?.project === 'string'),
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

/** Where one .NET connection string points: like DbTarget, from an appsettings file. */
export const DbConnectionSchema = z.object({
  name: z.string(),
  /** appsettings.json or appsettings.<Environment>.json. */
  file: z.string(),
  target: DbTargetSchema.omit({ source: true }),
  reach: z.object({ result: z.enum(REACH_RESULTS), reason: z.string().nullable() }),
});
export type DbConnection = z.infer<typeof DbConnectionSchema>;

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
  /** ConnectionStrings from appsettings for one environment; null when the package has no .NET project. */
  dotnet: z
    .object({
      environment: z.string(),
      /** Offered in the select: profile environments, environment files, then Production. */
      environments: z.array(z.string()),
      connections: z.array(DbConnectionSchema),
      /** More than 20 connections: the rest aren't shown. */
      truncated: z.boolean(),
    })
    .nullable(),
});
export type DbStatus = z.infer<typeof DbStatusSchema>;

export const databaseContract = defineContract({
  /** environment: the .NET environment to read ConnectionStrings for (default: the first launch profile's). */
  status: { input: z.strictObject({ environment: z.string().regex(ENVIRONMENT_NAME).optional() }), output: DbStatusSchema },
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
