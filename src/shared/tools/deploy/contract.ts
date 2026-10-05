import { z } from 'zod';
import { DEPLOY_PLATFORMS, type DeployPlatform } from '../../detected';
import { LogLineSchema, LogSnapshotSchema } from '../../processes';
import { defineContract, defineEvents, type ToolDefinition } from '../../tool';

export { DEPLOY_PLATFORMS, type DeployPlatform };

export const deployDefinition: ToolDefinition<Record<string, never>> = {
  id: 'deploy',
  name: 'Deploy',
  icon: 'rocket',
  // Every package: without a platform config the tab explains how to set one up.
  appliesTo: (p) => p.packageJson !== null || p.deploy.length > 0,
  settingsSchema: z.object({}),
};

export const PLATFORM_LABELS: Record<DeployPlatform, string> = {
  vercel: 'Vercel',
  netlify: 'Netlify',
  cloudflare: 'Cloudflare',
  fly: 'Fly.io',
};

const PlatformSchema = z.enum(DEPLOY_PLATFORMS);

export const DEPLOY_TARGETS = ['preview', 'production'] as const;
export type DeployTarget = (typeof DEPLOY_TARGETS)[number];
const TargetSchema = z.enum(DEPLOY_TARGETS);

/** What NestBox knows about one platform from local files and PATH; no network. */
export const PlatformStatusSchema = z.object({
  platform: PlatformSchema,
  /** The package's own CLI (through the package manager), a global one, or none. */
  cli: z.enum(['local', 'global', 'missing']),
  /** The install command to copy when the CLI is missing. */
  install: z.string(),
  linked: z.boolean(),
  /** Project, site, Worker or app name from the local config; null when unknown. */
  name: z.string().nullable(),
  /** Cloudflare only: Workers or Pages. */
  flavour: z.enum(['workers', 'pages']).nullable(),
  /** https only; null until known (Vercel's and Netlify's come from a listing). */
  dashboardUrl: z.string().nullable(),
  preview: z.boolean(),
  production: z.boolean(),
  /** Why a deploy button is missing, when one is. */
  hint: z.string().nullable(),
  /** Whether "Link" can open the CLI's link command in a terminal. */
  canLink: z.boolean(),
  /** The environments "Env" can compare against; the first is preselected. */
  environments: z.array(z.string()),
});
export type PlatformStatus = z.infer<typeof PlatformStatusSchema>;

export const LastDeploySchema = z.object({
  platform: PlatformSchema,
  target: TargetSchema,
  ok: z.boolean(),
  /** The platform URL found in the output (https), if any. */
  url: z.string().nullable(),
  at: z.number(),
});
export type LastDeploy = z.infer<typeof LastDeploySchema>;

export const READY_KINDS = ['node', 'deps', 'env', 'git', 'ci', 'script'] as const;
export const READY_TONES = ['pending', 'running', 'ok', 'warn', 'fail', 'skip'] as const;
export type ReadyTone = (typeof READY_TONES)[number];

export const ReadyCheckSchema = z.object({
  kind: z.enum(READY_KINDS),
  /** "Node", "Dependencies", "Env", "Git", "CI" or the script name. */
  label: z.string(),
  tone: z.enum(READY_TONES),
  detail: z.string().nullable(),
});
export type ReadyCheck = z.infer<typeof ReadyCheckSchema>;

export const ReadinessSchema = z.object({
  at: z.number(),
  /** null while checks are still running. */
  overall: z.enum(['green', 'amber', 'red']).nullable(),
  checks: z.array(ReadyCheckSchema),
});
export type Readiness = z.infer<typeof ReadinessSchema>;

/** Script names "Run checks" may start (they also have to be in package.json). */
export const SCRIPT_NAME = /^[A-Za-z0-9_][A-Za-z0-9_:.-]{0,99}$/;
/** Preselected when the package has them. */
export const DEFAULT_CHECK_SCRIPTS = ['build', 'test', 'lint', 'typecheck'];

export const DeployStatusSchema = z.object({
  platforms: z.array(PlatformStatusSchema),
  /** The deploy running now, if any (one per package). */
  action: z.object({ platform: PlatformSchema, target: TargetSchema }).nullable(),
  /** The last deploy started from NestBox this session. */
  last: LastDeploySchema.nullable(),
  /** Env files in the package folder (names only), and the one "Env" compares by default. */
  envFiles: z.array(z.string()),
  defaultEnvFile: z.string().nullable(),
  /** A root's workspace packages that have a platform config (the tab points to them). */
  elsewhere: z.array(
    z.object({ projectId: z.string(), name: z.string(), platforms: z.array(PlatformSchema) }),
  ),
  /** The package's scripts, for "Run checks". */
  scripts: z.array(z.string()),
  /** The last (or running) "Run checks" of this package this session. */
  ready: ReadinessSchema.nullable(),
});
export type DeployStatus = z.infer<typeof DeployStatusSchema>;

export const DEPLOY_STATES = [
  'ready',
  'building',
  'queued',
  'error',
  'canceled',
  'unknown',
] as const;
export type DeployState = (typeof DEPLOY_STATES)[number];

export const DeploymentSchema = z.object({
  id: z.string(),
  state: z.enum(DEPLOY_STATES),
  environment: z.enum(['production', 'preview']).nullable(),
  branch: z.string().nullable(),
  /** A short label: Fly's release version, a Pages commit, a Worker's version split. */
  label: z.string().nullable(),
  createdAt: z.number().nullable(),
  /** https only. */
  url: z.string().nullable(),
  /** https only: the platform's page for this deployment (build logs). */
  logsUrl: z.string().nullable(),
});
export type Deployment = z.infer<typeof DeploymentSchema>;

export const LISTING_FAILURES = [
  'cli-missing',
  'not-linked',
  'logged-out',
  'failed',
  'timeout',
] as const;
export type ListingFailure = (typeof LISTING_FAILURES)[number];

export const ListingSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('ok'), deployments: z.array(DeploymentSchema) }),
  /** Netlify: the linked site; its deploy history opens on Netlify. */
  z.object({
    state: z.literal('site'),
    name: z.string().nullable(),
    url: z.string().nullable(),
    adminUrl: z.string().nullable(),
  }),
  z.object({ state: z.enum(LISTING_FAILURES) }),
]);
export type Listing = z.infer<typeof ListingSchema>;

/** Key names only: values never leave main. */
export const EnvCompareSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('ok'),
    onlyLocal: z.array(z.string()),
    onlyRemote: z.array(z.string()),
    both: z.array(z.string()),
  }),
  z.object({ state: z.enum([...LISTING_FAILURES, 'no-file']) }),
]);
export type EnvCompare = z.infer<typeof EnvCompareSchema>;

const DeployResultSchema = z.object({
  ok: z.boolean(),
  code: z.number().int().nullable(),
  url: z.string().nullable(),
});
export type DeployResult = z.infer<typeof DeployResultSchema>;

export const deployContract = defineContract({
  status: { input: z.strictObject({}), output: DeployStatusSchema },
  /** Network: runs the platform's CLI. The tab calls it when it opens and on Refresh. */
  deployments: { input: z.strictObject({ platform: PlatformSchema }), output: ListingSchema },
  /** Production only with `confirmed: true`: the renderer asks first, naming the package and the platform. */
  deploy: {
    input: z
      .strictObject({
        platform: PlatformSchema,
        target: TargetSchema,
        confirmed: z.literal(true).optional(),
      })
      .refine((i) => i.target === 'preview' || i.confirmed === true, 'Confirm a production deploy'),
    output: DeployResultSchema,
  },
  cancel: { input: z.strictObject({}), output: z.void() },
  /** Instant checks, then the picked scripts one at a time; progress through `changed`. */
  checkReady: {
    input: z.strictObject({ scripts: z.array(z.string().regex(SCRIPT_NAME)).max(10) }),
    output: ReadinessSchema,
  },
  /** Network: the platform's keys for one environment against one local env file's keys. */
  envCompare: {
    input: z.strictObject({
      platform: PlatformSchema,
      environment: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/),
      file: z.string().regex(/^\.env(\.[^/\\]+)?$/),
    }),
    output: EnvCompareSchema,
  },
  /** Opens a terminal with the CLI's login command. */
  login: { input: z.strictObject({ platform: PlatformSchema }), output: z.void() },
  /** Opens a terminal with the CLI's link command (Vercel, Netlify), also to set a package up. */
  link: { input: z.strictObject({ platform: PlatformSchema }), output: z.void() },
  getLogs: {
    input: z.strictObject({ afterSeq: z.number().int().nonnegative().optional() }),
    output: LogSnapshotSchema,
  },
  clearLogs: { input: z.strictObject({}), output: z.void() },
});

export const deployEvents = defineEvents({
  /** The running deploy, the last deploy or something a listing learned (dashboard, production branch) changed. */
  changed: z.undefined(),
  logs: z.object({ lines: z.array(LogLineSchema) }),
});
