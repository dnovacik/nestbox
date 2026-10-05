import { z } from 'zod';
import { defineContract, defineEvents, type ToolDefinition } from '../../tool';

export const ciDefinition: ToolDefinition<Record<string, never>> = {
  id: 'ci',
  name: 'CI',
  icon: 'workflow',
  // CI belongs to a repository: only folders with their own .git, like the Git tool.
  appliesTo: (p) => p.git !== null,
  settingsSchema: z.object({}),
};

export const CI_PROVIDERS = ['github', 'gitlab'] as const;
export type CiProvider = (typeof CI_PROVIDERS)[number];

export const PROVIDER_LABELS: Record<CiProvider, string> = {
  github: 'GitHub Actions',
  gitlab: 'GitLab CI',
};

export const CI_STATES = [
  'queued',
  'running',
  'success',
  'failure',
  'canceled',
  'skipped',
  'manual',
  'unknown',
] as const;
export type CiState = (typeof CI_STATES)[number];

export const isActive = (state: CiState) => state === 'queued' || state === 'running';

/** Run and job ids: digits only (they reach a command line). */
export const CI_ID = /^[0-9]{1,20}$/;
const IdSchema = z.string().regex(CI_ID);

export const CiRunSchema = z.object({
  id: z.string(),
  /** The commit or pull request title. Shown, never logged. */
  title: z.string().nullable(),
  /** GitHub: the workflow; GitLab: null (one pipeline per commit). */
  workflow: z.string().nullable(),
  branch: z.string().nullable(),
  sha: z.string().nullable(),
  /** push, pull_request, schedule, merge_request_event, web… */
  event: z.string().nullable(),
  state: z.enum(CI_STATES),
  createdAt: z.number().nullable(),
  updatedAt: z.number().nullable(),
  /** https only. */
  url: z.string().nullable(),
});
export type CiRun = z.infer<typeof CiRunSchema>;

export const CiJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** GitLab only. */
  stage: z.string().nullable(),
  state: z.enum(CI_STATES),
  /** GitLab's allow_failure: a failure that doesn't fail the pipeline. */
  allowFailure: z.boolean(),
  /** GitHub: the first failed step's name. */
  failedStep: z.string().nullable(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  url: z.string().nullable(),
});
export type CiJob = z.infer<typeof CiJobSchema>;

export const CI_FAILURES = [
  'no-provider',
  'cli-missing',
  'logged-out',
  'no-remote',
  'failed',
  'timeout',
] as const;
export type CiFailure = (typeof CI_FAILURES)[number];
const FailureSchema = z.object({ state: z.enum(CI_FAILURES) });

export const CiStatusSchema = z.object({
  provider: z.enum(CI_PROVIDERS).nullable(),
  cli: z.enum(['found', 'missing']),
  /** Where to get the CLI (a URL), shown with Copy. */
  install: z.string().nullable(),
  /** The command the Log in button opens in a terminal. */
  loginCommand: z.string().nullable(),
  /** The current branch, read live; null when HEAD is detached. */
  branch: z.string().nullable(),
  /** The current branch's newest run seen this session (no network). */
  latest: CiRunSchema.nullable(),
  /** A re-run in progress. */
  busy: z.boolean(),
});
export type CiStatus = z.infer<typeof CiStatusSchema>;

export const CiRunsSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('ok'),
    branch: z.string().nullable(),
    /** false when the branch name couldn't be passed on and every branch is listed. */
    filtered: z.boolean(),
    runs: z.array(CiRunSchema),
  }),
  FailureSchema,
]);
export type CiRuns = z.infer<typeof CiRunsSchema>;

export const CiJobsSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('ok'), jobs: z.array(CiJobSchema) }),
  FailureSchema,
]);
export type CiJobs = z.infer<typeof CiJobsSchema>;

export const LOG_TAIL_LINES = 200;

export const CiLogSchema = z.discriminatedUnion('state', [
  /** The last lines, ANSI codes stripped. Shown, never stored or logged. */
  z.object({ state: z.literal('ok'), lines: z.array(z.string()), truncated: z.boolean() }),
  FailureSchema,
]);
export type CiLog = z.infer<typeof CiLogSchema>;

export const CiLatestSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('ok'), branch: z.string().nullable(), run: CiRunSchema.nullable() }),
  FailureSchema,
]);
export type CiLatest = z.infer<typeof CiLatestSchema>;

export const ciContract = defineContract({
  status: { input: z.strictObject({}), output: CiStatusSchema },
  /** Network: the provider's CLI. The tab calls it when it opens, on Refresh, and every 20 s while one runs. */
  runs: {
    input: z.strictObject({ scope: z.enum(['branch', 'all']) }),
    output: CiRunsSchema,
  },
  jobs: { input: z.strictObject({ runId: IdSchema }), output: CiJobsSchema },
  jobLog: { input: z.strictObject({ runId: IdSchema, jobId: IdSchema }), output: CiLogSchema },
  rerunFailed: {
    input: z.strictObject({ runId: IdSchema }),
    output: z.object({ ok: z.boolean(), retried: z.number().int().nonnegative() }),
  },
  /** The current branch's newest run, for Ready to deploy. */
  latest: { input: z.strictObject({}), output: CiLatestSchema },
  /** Opens a terminal with the CLI's login command. */
  login: { input: z.strictObject({}), output: z.void() },
});

export const ciEvents = defineEvents({
  /** `latest` or `busy` changed. */
  changed: z.undefined(),
});
