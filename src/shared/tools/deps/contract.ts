import { z } from 'zod';
import { PACKAGE_MANAGERS } from '../../detected';
import { DEPS_SCHEDULES } from '../../types';
import { defineContract, defineEvents, type ToolDefinition } from '../../tool';

export const depsDefinition: ToolDefinition<Record<string, never>> = {
  id: 'deps',
  name: 'Dependencies',
  icon: 'package',
  appliesTo: (p) => p.packageJson !== null,
  settingsSchema: z.object({}),
};

export const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const DEP_TYPES = ['prod', 'dev', 'optional', 'peer'] as const;
export type DepType = (typeof DEP_TYPES)[number];

export const AdvisorySchema = z.object({
  id: z.string(),
  title: z.string(),
  severity: z.enum(SEVERITIES),
  /** https only; null otherwise. */
  url: z.string().nullable(),
  /** The vulnerable versions, as the advisory says. */
  range: z.string().nullable(),
});
export type Advisory = z.infer<typeof AdvisorySchema>;

export const DepRowSchema = z.object({
  name: z.string(),
  /** null for a vulnerable transitive package. */
  type: z.enum(DEP_TYPES).nullable(),
  /** The spec in package.json; null for a transitive package. */
  range: z.string().nullable(),
  /** Installed version; null when it isn't installed or can't be read (Plug'n'Play). */
  current: z.string().nullable(),
  wanted: z.string().nullable(),
  latest: z.string().nullable(),
  outdated: z.boolean(),
  /** latest is a new major over the installed (or wanted) version. */
  major: z.boolean(),
  advisories: z.array(AdvisorySchema),
});
export type DepRow = z.infer<typeof DepRowSchema>;

export const STEPS = ['outdated', 'audit'] as const;
export const StepErrorSchema = z.object({
  step: z.enum(STEPS),
  code: z.enum(['failed', 'timeout']),
});
export type StepError = z.infer<typeof StepErrorSchema>;

export const PackageResultSchema = z.object({
  projectId: z.string(),
  relPath: z.string(),
  name: z.string(),
  /** The package manager that ran; Yarn 2+ is 'yarn-berry' (its commands differ from Yarn 1's). */
  manager: z.enum([...PACKAGE_MANAGERS, 'yarn-berry']),
  checkedAt: z.number(),
  rows: z.array(DepRowSchema),
  errors: z.array(StepErrorSchema),
});
export type PackageResult = z.infer<typeof PackageResultSchema>;

export const ResultsSchema = z.object({
  /** This package, or a root and its workspace packages (root first); only the ones checked so far. */
  packages: z.array(PackageResultSchema),
  checking: z.boolean(),
});
export type Results = z.infer<typeof ResultsSchema>;

export const depsContract = defineContract({
  results: { input: z.strictObject({}), output: ResultsSchema },
  /** Runs the package managers (network); resolves when the check is done. */
  check: { input: z.strictObject({}), output: ResultsSchema },
  copyUpdateCommand: {
    input: z.strictObject({ relPath: z.string().max(4096), name: z.string().min(1).max(214) }),
    output: z.object({ command: z.string() }),
  },
});

export const depsEvents = defineEvents({
  /** A check started or finished. */
  changed: z.undefined(),
});

/** Counts for a card or the overview. */
export function summarize(packages: readonly PackageResult[]) {
  const rows = packages.flatMap((p) => p.rows);
  const severity = (s: Severity) =>
    rows.filter((r) => r.advisories.some((a) => a.severity === s)).length;
  return {
    outdated: rows.filter((r) => r.outdated).length,
    major: rows.filter((r) => r.outdated && r.major).length,
    vulnerable: rows.filter((r) => r.advisories.length > 0).length,
    critical: severity('critical'),
    high: severity('high'),
    errors: packages.reduce((n, p) => n + p.errors.length, 0),
    checkedAt: packages.length > 0 ? Math.min(...packages.map((p) => p.checkedAt)) : null,
  };
}

/** The highest severity among a row's advisories. */
export function worstSeverity(advisories: readonly Advisory[]): Severity | null {
  let worst = -1;
  for (const a of advisories) worst = Math.max(worst, SEVERITIES.indexOf(a.severity));
  return worst < 0 ? null : (SEVERITIES[worst] ?? null);
}

/** The Dependencies page: every root project's last results (its workspace packages included). */
export const DepsOverviewSchema = z.object({
  projects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      packages: z.array(PackageResultSchema),
      checking: z.boolean(),
    }),
  ),
  /** "Check all now" or the schedule is going through the projects. */
  runningAll: z.boolean(),
  schedule: z.enum(DEPS_SCHEDULES),
});
export type DepsOverview = z.infer<typeof DepsOverviewSchema>;
