// Local domains (v1.30): settings, the status the renderer shows, and the channel inputs.
import { z } from 'zod';

/** One DNS label as NestBox uses it: lowercase letters, digits and inner dashes, 1–63 characters. */
export const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const Port = z.number().int().min(1).max(65_535);
const Id = z.string().min(1).max(512);

export const TRUST_STATES = ['none', 'trusted', 'untrusted'] as const;

export const DomainsSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  httpPort: Port.default(80),
  httpsPort: Port.default(443),
  /** projectId (a workspace package's is <rootId>::<relPath>) → label override. */
  names: z.record(z.string(), z.string().regex(LABEL)).default({}),
  /** projectIds whose Host header is rewritten to localhost:<port>. */
  rewriteHost: z.record(z.string(), z.literal(true)).default({}),
  trust: z.enum(TRUST_STATES).default('none'),
});
export type DomainsSettings = z.infer<typeof DomainsSettingsSchema>;

export const ServerStateSchema = z.object({
  state: z.enum(['off', 'running', 'failed']),
  port: Port,
  /** The bind error's code (EADDRINUSE, EACCES); null otherwise. */
  code: z.string().nullable(),
  /** Who holds the port, when it is taken and known (a process name or "<project> · <script>"). */
  owner: z.string().nullable(),
});
export type ServerState = z.infer<typeof ServerStateSchema>;

export const ROUTE_SOURCES = ['main', 'script', 'detected', 'none'] as const;

export const RouteSchema = z.object({
  /** The full host name, e.g. shop.localhost or storybook.shop.localhost. */
  name: z.string(),
  projectId: z.string(),
  /** The script whose port this is (main or script routes); null for detected or none. */
  script: z.string().nullable(),
  port: Port.nullable(),
  source: z.enum(ROUTE_SOURCES),
  /** The project's Host header is rewritten to localhost:<port> (the Local domain dialog shows it). */
  rewriteHost: z.boolean(),
});
export type Route = z.infer<typeof RouteSchema>;

export const DomainsStatusSchema = z.object({
  enabled: z.boolean(),
  http: ServerStateSchema,
  https: ServerStateSchema,
  trust: z.enum(TRUST_STATES),
  routes: z.array(RouteSchema),
  /** Project ids whose name got a -2, -3, … suffix. */
  clashes: z.array(z.string()),
});
export type DomainsStatus = z.infer<typeof DomainsStatusSchema>;

export const DomainsPortsInputSchema = z
  .strictObject({ httpPort: Port, httpsPort: Port })
  .refine((p) => p.httpPort !== p.httpsPort, 'ports must differ');
export const DomainsNameInputSchema = z.strictObject({
  projectId: Id,
  label: z.string().regex(LABEL).nullable(),
});
export const DomainsRewriteInputSchema = z.strictObject({ projectId: Id, rewrite: z.boolean() });

export const TrustResultSchema = z.object({
  result: z.enum(['trusted', 'cancelled', 'failed', 'removed']),
});
export type TrustResult = z.infer<typeof TrustResultSchema>;
