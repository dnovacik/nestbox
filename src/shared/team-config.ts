// Team config (v1.31): the committed .nestbox.json that shares commands, run groups, health checks, mock
// routes and local domain names with teammates. Canonical content, keys, trust states and channel inputs.
import { z } from 'zod';
import { LABEL } from './domains';
import { TEAM_SECTIONS } from './team-config-project';
import { StoredCheckSchema } from './tools/health/contract';
import { RouteSchema } from './tools/mock/contract';
import { CustomCommandSchema, EnvFileEntrySchema } from './tools/scripts/contract';
import { RunGroupSchema } from './types';

export {
  TEAM_SECTIONS,
  type TeamSection,
  TeamConfigProjectSchema,
  type TeamConfigProject,
} from './team-config-project';

export const TEAM_FILE = '.nestbox.json';
export const TEAM_FILE_MAX_BYTES = 256 * 1024;
export const MAX_TEAM_RUN_GROUPS = 50;

export const ORIGINS = ['team', 'local', 'override'] as const;
export type Origin = (typeof ORIGINS)[number];

export const TRUST_STATES = [
  'none',
  'pending',
  'accepted',
  'changed',
  'ignored',
  'invalid',
] as const;
export type TeamTrustState = (typeof TRUST_STATES)[number];

/** A package's posix relPath inside the root ('' = the root): no '#', no '..', not absolute. */
export const PackagePathSchema = z
  .string()
  .max(512)
  .refine(
    (p) =>
      p === '' ||
      (!p.startsWith('/') && !p.includes('\\') && !p.includes('#') && !/^[A-Za-z]:/.test(p)),
    'not a package path',
  )
  .refine(
    (p) => p.split('/').every((seg) => seg !== '..' && seg !== '.' && (p === '' || seg !== '')),
    'not a package path',
  );

/** The validated, canonical content of a team file, in the tools' own shapes (relPath, not package). */
export const TeamContentSchema = z.object({
  commands: z.array(CustomCommandSchema).max(100),
  main: z.record(z.string(), z.string()),
  envFiles: z.array(EnvFileEntrySchema).max(500),
  hidden: z.record(z.string(), z.array(z.string())),
  runGroups: z.array(RunGroupSchema).max(MAX_TEAM_RUN_GROUPS),
  health: z.record(
    z.string(),
    z.object({
      intervalSec: z.number().int().min(5).max(600).nullable(),
      checks: z.array(StoredCheckSchema).max(20),
    }),
  ),
  mock: z.record(z.string(), z.object({ routes: z.array(RouteSchema).max(100) })),
  domainNames: z.record(z.string(), z.string().regex(LABEL)),
  rewriteHost: z.record(z.string(), z.literal(true)),
});
export type TeamContent = z.infer<typeof TeamContentSchema>;

export const EMPTY_CONTENT: TeamContent = {
  commands: [],
  main: {},
  envFiles: [],
  hidden: {},
  runGroups: [],
  health: {},
  mock: {},
  domainNames: {},
  rewriteHost: {},
};

/** `package#rest`: a package path never contains '#', so the first '#' splits. */
export const itemKey = (pkg: string, rest: string) => `${pkg}#${rest}`;
export function splitKey(key: string): { pkg: string; rest: string } {
  const at = key.indexOf('#');
  return at === -1 ? { pkg: '', rest: key } : { pkg: key.slice(0, at), rest: key.slice(at + 1) };
}

export const TeamWarningSchema = z.object({
  section: z.string(),
  index: z.number().int().nullable(),
  reason: z.string(),
});
export type TeamWarning = z.infer<typeof TeamWarningSchema>;

export const TeamStatusSchema = z.object({
  state: z.enum(TRUST_STATES),
  /** First 12 hex chars of the file's content hash; null without a readable file. */
  hash: z.string().nullable(),
  counts: z.object({
    commands: z.number(),
    runGroups: z.number(),
    healthChecks: z.number(),
    mockRoutes: z.number(),
    domainNames: z.number(),
  }),
  warnings: z.array(TeamWarningSchema),
  /** invalid: why (e.g. "Line 4, column 2: unexpected token", "made by a newer NestBox"). */
  error: z.string().nullable(),
  /** The store couldn't be saved: accepting works for this session only. */
  readOnly: z.boolean(),
});
export type TeamStatus = z.infer<typeof TeamStatusSchema>;

const ChangeSchema = z.object({
  section: z.enum(TEAM_SECTIONS),
  key: z.string(),
  change: z.enum(['added', 'changed', 'removed']),
});
export const TeamReviewSchema = z.object({
  /** The full hash to pass back to accept. */
  hash: z.string().nullable(),
  content: TeamContentSchema,
  /** changed only: what differs from the accepted snapshot. */
  diff: z.array(ChangeSchema).nullable(),
  warnings: z.array(TeamWarningSchema),
});
export type TeamReview = z.infer<typeof TeamReviewSchema>;

const ProjectId = z.string().min(1).max(512);
export const TeamProjectInputSchema = z.strictObject({ projectId: ProjectId });
export const TeamAcceptInputSchema = z.strictObject({
  projectId: ProjectId,
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});
export const TeamItemInputSchema = z.strictObject({
  projectId: ProjectId,
  section: z.enum(TEAM_SECTIONS),
  key: z.string().min(1).max(700),
});
