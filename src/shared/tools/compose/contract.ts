import { z } from 'zod';
import { LogLineSchema, LogSnapshotSchema } from '../../processes';
import { defineContract, defineEvents, type ToolDefinition } from '../../tool';
import { SERVICE_NAME } from '../../types';

export { SERVICE_NAME };

const ServiceNameSchema = z.string().regex(SERVICE_NAME);

export const composeDefinition: ToolDefinition<Record<string, never>> = {
  id: 'compose',
  name: 'Compose',
  icon: 'container',
  appliesTo: (p) => p.dockerCompose !== null,
  settingsSchema: z.object({}),
};

export const SERVICE_STATES = [
  'running',
  'restarting',
  'paused',
  'created',
  'removing',
  'exited',
  'dead',
  'not-created',
] as const;
export type ServiceState = (typeof SERVICE_STATES)[number];

const ServicePortSchema = z.object({
  published: z.number().int(),
  target: z.number().int(),
  protocol: z.string(),
});
export type ServicePort = z.infer<typeof ServicePortSchema>;

export const ServiceViewSchema = z.object({
  name: z.string(),
  state: z.enum(SERVICE_STATES),
  health: z.enum(['healthy', 'unhealthy', 'starting']).nullable(),
  exitCode: z.number().int().nullable(),
  ports: z.array(ServicePortSchema),
});
export type ServiceView = z.infer<typeof ServiceViewSchema>;

export const ACTIONS = ['up', 'stop', 'restart', 'down'] as const;
export type ComposeAction = (typeof ACTIONS)[number];

export const ComposeStatusSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('ok'),
    file: z.string(),
    services: z.array(ServiceViewSchema),
    /** The action running now, if any. */
    action: z.object({ name: z.enum(ACTIONS), service: z.string().nullable() }).nullable(),
    /** The service whose logs are followed. */
    following: z.string().nullable(),
  }),
  z.object({ state: z.enum(['docker-missing', 'daemon-down', 'invalid']), file: z.string() }),
]);
export type ComposeStatus = z.infer<typeof ComposeStatusSchema>;

export const LOG_SOURCES = ['actions', 'service'] as const;
const SourceSchema = z.enum(LOG_SOURCES);
export type LogSource = z.infer<typeof SourceSchema>;

const ActionResultSchema = z.object({ ok: z.boolean(), code: z.number().int().nullable() });
export type ActionResult = z.infer<typeof ActionResultSchema>;

/** One service, several (a run group's; names that left the file are dropped), or neither for the stack. */
const TargetSchema = {
  service: ServiceNameSchema.optional(),
  services: z.array(ServiceNameSchema).max(50).optional(),
};
const oneTarget = (i: { service?: string; services?: string[] }) =>
  i.service === undefined || i.services === undefined;

export const composeContract = defineContract({
  status: { input: z.strictObject({}), output: ComposeStatusSchema },
  up: {
    input: z
      .strictObject({ ...TargetSchema, wait: z.boolean().optional() })
      .refine(oneTarget, 'Pass service or services, not both'),
    output: ActionResultSchema,
  },
  stop: {
    input: z.strictObject(TargetSchema).refine(oneTarget, 'Pass service or services, not both'),
    output: ActionResultSchema,
  },
  restart: { input: z.strictObject({ service: ServiceNameSchema }), output: ActionResultSchema },
  /** Removes containers and networks; never volumes or images. The renderer confirms first. */
  down: { input: z.strictObject({}), output: ActionResultSchema },
  follow: { input: z.strictObject({ service: ServiceNameSchema }), output: z.void() },
  unfollow: { input: z.strictObject({}), output: z.void() },
  getLogs: {
    input: z.strictObject({
      source: SourceSchema,
      afterSeq: z.number().int().nonnegative().optional(),
    }),
    output: LogSnapshotSchema,
  },
  clearLogs: { input: z.strictObject({ source: SourceSchema }), output: z.void() },
});

export const composeEvents = defineEvents({
  /** Services, the running action or the followed service changed. */
  changed: z.undefined(),
  logs: z.object({ source: SourceSchema, lines: z.array(LogLineSchema) }),
});
