import { z } from 'zod';
import { defineContract, defineEvents, type ToolDefinition } from '../../tool';

const settingsSchema = z.strictObject({});

export const gitDefinition: ToolDefinition<z.infer<typeof settingsSchema>> = {
  id: 'git',
  name: 'Git',
  icon: 'git-branch',
  // Only folders with their own .git (workspace packages share the root's repository).
  appliesTo: (p) => p.git !== null,
  settingsSchema,
};

/** The panel lists at most this many file rows; the counts always cover every change. */
export const MAX_GIT_FILES = 500;

export const GIT_GROUPS = ['conflicts', 'staged', 'changes', 'untracked'] as const;
export const GIT_OPERATIONS = ['merge', 'rebase', 'cherry-pick', 'revert', 'bisect'] as const;

/** One row of the panel. A path changed in both the index and the tree has a row in each group. */
export const GitFileSchema = z.object({
  /** Relative to the repository root, '/'-separated, as git prints it. */
  path: z.string(),
  /** The old path of a rename or copy. */
  origPath: z.string().nullable(),
  group: z.enum(GIT_GROUPS),
  /** git's status letter for the group: M, A, D, R, C, T, U (conflict) or ? (untracked). */
  status: z.string().length(1),
  /** false for a deleted file (nothing to open). */
  exists: z.boolean(),
});
export type GitFile = z.infer<typeof GitFileSchema>;

const Count = z.number().int().nonnegative();

export const GitChangesSchema = z.object({
  /** Changed paths, each counted once. */
  total: Count,
  staged: Count,
  unstaged: Count,
  untracked: Count,
  conflicted: Count,
  /** The status output hit its size cap: the counts are lower bounds. */
  truncated: z.boolean(),
});
export type GitChanges = z.infer<typeof GitChangesSchema>;

export const GitStatusSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('ok'),
    /** null when HEAD is detached. */
    branch: z.string().nullable(),
    /** The short hash when HEAD is detached. */
    detachedAt: z.string().nullable(),
    operation: z.enum(GIT_OPERATIONS).nullable(),
    upstream: z.string().nullable(),
    /** Against the last-fetched upstream ref; null without an upstream. */
    ahead: Count.nullable(),
    behind: Count.nullable(),
    /** When git last fetched (FETCH_HEAD's mtime, ms); null if it never has. */
    lastFetchAt: z.number().nullable(),
    changes: GitChangesSchema,
    files: z.array(GitFileSchema).max(MAX_GIT_FILES),
    /** null on a branch with no commits yet. */
    lastCommit: z
      .object({ hash: z.string(), subject: z.string(), author: z.string(), at: z.number() })
      .nullable(),
  }),
  /** git is not installed (or not on PATH). */
  z.object({ state: z.literal('git-missing') }),
  /** git exits 128: not a repository, or git refuses it (safe.directory). */
  z.object({ state: z.literal('not-a-repo') }),
  /** A timeout or another error. */
  z.object({ state: z.literal('failed') }),
]);
export type GitStatus = z.infer<typeof GitStatusSchema>;

/** A path relative to the repository, as status printed it. The main side checks it stays inside. */
export const GitPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((p) => !p.includes('\0'), { message: 'nul' });

export const gitContract = defineContract({
  status: { input: z.strictObject({}), output: GitStatusSchema },
  /** Opens a changed file in the editor. */
  openFile: { input: z.strictObject({ path: GitPathSchema }), output: z.void() },
});

export const gitEvents = defineEvents({
  /** Something under .git changed (a commit, checkout, stage, fetch). */
  changed: z.undefined(),
});
