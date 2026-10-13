import { z } from 'zod';
import { PACKAGE_MANAGERS } from '../../detected';
import { defineContract, type ToolDefinition } from '../../tool';

const settingsSchema = z.object({
  /** Run scripts through fnm on the required version (root project; offered when fnm is found). */
  fnm: z.boolean().default(false),
});
export type NodeSettings = z.infer<typeof settingsSchema>;

export const nodeDefinition: ToolDefinition<NodeSettings> = {
  id: 'node',
  name: 'Node',
  icon: 'hexagon',
  appliesTo: (p) => p.packageJson !== null,
  settingsSchema,
};

export const SOURCE_KINDS = ['nvmrc', 'node-version', 'engines', 'volta'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Where a requirement comes from, as the panel names it. */
export const SOURCE_LABELS: Record<SourceKind, string> = {
  nvmrc: '.nvmrc',
  'node-version': '.node-version',
  engines: 'engines.node',
  volta: 'volta.node',
};

export const SourceViewSchema = z.object({
  kind: z.enum(SOURCE_KINDS),
  /** The value as written (trimmed, at most 100 characters); null when the file couldn't be read. */
  value: z.string().nullable(),
  /** From the root project rather than the package itself. */
  fromRoot: z.boolean(),
  valid: z.boolean(),
  /** Disagrees with the requirement (the first source with a range). */
  conflict: z.boolean(),
});
export type SourceView = z.infer<typeof SourceViewSchema>;

export const VERSION_MANAGERS = ['fnm', 'volta', 'nvm', 'nvm-windows'] as const;
export type VersionManager = (typeof VERSION_MANAGERS)[number];

export const NODE_STATES = ['ok', 'mismatch', 'conflict', 'unknown'] as const;
export type NodeState = (typeof NODE_STATES)[number];

/** What the Node tab can do about the status, each on the user's click. Version tokens are plain words. */
export const NodeFixesSchema = z.object({
  /** fnm is found and Node doesn't match: `fnm install <this>` in a terminal. */
  fnmInstall: z.string().nullable(),
  /** nvm or nvm-windows and Node doesn't match: the commands to copy. */
  nvm: z.string().nullable(),
  /** No .nvmrc or .node-version in the package or its root: the version to write to the root's .nvmrc. */
  nvmrc: z.string().nullable(),
});
export type NodeFixes = z.infer<typeof NodeFixesSchema>;

export const NodeStatusSchema = z.object({
  state: z.enum(NODE_STATES),
  sources: z.array(SourceViewSchema),
  /** The source the requirement comes from; null when there is none. */
  requirement: z.enum(SOURCE_KINDS).nullable(),
  node: z.object({
    /** What `node --version` printed (scripts' PATH, or fnm's when the switch is on); null when Node wasn't found. */
    version: z.string().nullable(),
    /** null when there is no requirement, or it can't be resolved offline (`lts/*`). */
    ok: z.boolean().nullable(),
  }),
  /** Only when package.json has a valid packageManager field. */
  packageManager: z
    .object({
      name: z.enum(PACKAGE_MANAGERS),
      version: z.string(),
      /** The manager the lockfile says, if any. */
      detected: z.enum(PACKAGE_MANAGERS).nullable(),
      /** What `<name> --version` printed; null when it couldn't be run (Corepack offline, not installed). */
      installed: z.string().nullable(),
      ok: z.boolean().nullable(),
    })
    .nullable(),
  /** Lockfiles of more than one manager ("Two lockfiles: …; NestBox uses yarn"); null otherwise. */
  lockfileWarning: z.string().nullable().default(null),
  manager: z.enum(VERSION_MANAGERS).nullable(),
  fixes: NodeFixesSchema.default({ fnmInstall: null, nvm: null, nvmrc: null }),
  fnm: z.object({
    /** fnm was found and the requirement gives it a version. */
    available: z.boolean(),
    on: z.boolean(),
    /** The version passed to `fnm exec --using=`. */
    version: z.string().nullable(),
  }),
  checkedAt: z.number(),
});
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

export const StartAdviceSchema = z.object({
  /** Shown on the script row and as the log's first line; null when the versions match. */
  warning: z.string().nullable(),
  /** A folder to put first on the script's PATH (fnm's Node). */
  pathPrepend: z.string().nullable(),
  /** An extra log line, e.g. that fnm couldn't provide the version. */
  note: z.string().nullable(),
});
export type StartAdvice = z.infer<typeof StartAdviceSchema>;

export const nodeContract = defineContract({
  status: { input: z.strictObject({}), output: NodeStatusSchema },
  /** Drops the cache and checks again. */
  refresh: { input: z.strictObject({}), output: NodeStatusSchema },
  setFnm: { input: z.strictObject({ enabled: z.boolean() }), output: NodeStatusSchema },
  /** Asked by the scripts tool before each start. */
  startAdvice: { input: z.strictObject({}), output: StartAdviceSchema },
  /** Opens a terminal with `fnm install <version>` (fixes.fnmInstall); CONFLICT when there is none. */
  fnmInstall: { input: z.strictObject({}), output: z.void() },
  /** Writes fixes.nvm to the clipboard from main; CONFLICT when there is none. */
  copyNvmCommand: { input: z.strictObject({}), output: z.void() },
  /** Writes fixes.nvmrc to the root's .nvmrc (never over an existing one: CONFLICT) and checks again. */
  createNvmrc: { input: z.strictObject({}), output: NodeStatusSchema },
});
