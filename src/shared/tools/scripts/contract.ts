import { z } from 'zod';
import { LogLineSchema, LogSnapshotSchema, MAX_EXPORT_SEQS, ProcessSummarySchema } from '../../processes';
import { defineContract, defineEvents, type ToolDefinition } from '../../tool';
import { RunGroupEntrySchema, RunGroupSchema } from '../../types';

const ScriptName = z.string().min(1).max(200);
const ScriptInput = z.strictObject({ script: ScriptName });
const GroupName = z.string().trim().min(1).max(60);

const settingsSchema = z.object({
  /** Scripts with auto-restart on, across the root and its workspace packages. */
  autoRestart: z.array(RunGroupEntrySchema).max(500).default([]),
});
export type ScriptsSettings = z.infer<typeof settingsSchema>;

export const scriptsDefinition: ToolDefinition<ScriptsSettings> = {
  id: 'scripts',
  name: 'Scripts',
  icon: 'terminal',
  appliesTo: (p) => Object.keys(p.packageJson?.scripts ?? {}).length > 0 || p.workspaces.length > 0,
  settingsSchema,
};

export const ScriptInfoSchema = z.object({ name: z.string(), command: z.string(), autoRestart: z.boolean() });
export type ScriptInfo = z.infer<typeof ScriptInfoSchema>;

export const PackageScriptsSchema = z.object({ relPath: z.string(), name: z.string(), scripts: z.array(z.string()) });
export type PackageScripts = z.infer<typeof PackageScriptsSchema>;

export const SkippedEntrySchema = RunGroupEntrySchema.extend({ reason: z.enum(['missing', 'running']) });
export type SkippedEntry = z.infer<typeof SkippedEntrySchema>;

export { MAX_EXPORT_SEQS } from '../../processes';

export const scriptsContract = defineContract({
  list: {
    input: z.strictObject({}),
    output: z.object({
      scripts: z.array(ScriptInfoSchema),
      /** Root projects only; null for workspace packages. */
      runGroups: z.array(RunGroupSchema).nullable(),
      /** Root projects only: every package's scripts, for the run group editor. */
      packages: z.array(PackageScriptsSchema).nullable(),
    }),
  },
  start: { input: ScriptInput, output: ProcessSummarySchema },
  stop: { input: ScriptInput, output: ProcessSummarySchema },
  restart: { input: ScriptInput, output: ProcessSummarySchema },
  setAutoRestart: {
    input: z.strictObject({ script: ScriptName, enabled: z.boolean() }),
    output: z.object({ enabled: z.boolean() }),
  },
  getLogs: {
    input: z.strictObject({ script: ScriptName, afterSeq: z.number().int().nonnegative().optional() }),
    output: LogSnapshotSchema,
  },
  clearLogs: { input: ScriptInput, output: z.void() },
  exportLogs: {
    input: z.strictObject({
      script: ScriptName,
      seqs: z.union([z.literal('all'), z.array(z.number().int().positive()).max(MAX_EXPORT_SEQS)]),
    }),
    output: z.object({ saved: z.boolean() }),
  },
  openFileAt: {
    input: z.strictObject({ path: z.string().min(1).max(4096), line: z.number().int().positive() }),
    output: z.void(),
  },
  saveRunGroup: {
    input: z.strictObject({ previousName: GroupName.optional(), group: RunGroupSchema }),
    output: z.array(RunGroupSchema),
  },
  deleteRunGroup: { input: z.strictObject({ name: GroupName }), output: z.array(RunGroupSchema) },
  startRunGroup: {
    input: z.strictObject({ name: GroupName }),
    output: z.object({ started: z.array(ProcessSummarySchema), skipped: z.array(SkippedEntrySchema) }),
  },
  stopRunGroup: { input: z.strictObject({ name: GroupName }), output: z.void() },
});

export const scriptsEvents = defineEvents({
  /** A batch of new lines for one script, about every 50 ms. */
  logs: z.object({ script: z.string(), lines: z.array(LogLineSchema) }),
});
