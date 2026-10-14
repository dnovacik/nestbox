// The Node module's project info, shared by main and the renderer: the schema and nodeOf(), the one way
// to read a package's package.json data (name, scripts) and its package manager.
import { z } from 'zod';
import { type DetectedProject, PACKAGE_MANAGERS } from '../detected';

/** In priority order (Next before Vite, NestJS before Express); main's framework.ts holds the matchers. */
export const FRAMEWORK_IDS = [
  'next',
  'nuxt',
  'remix',
  'astro',
  'sveltekit',
  'nestjs',
  'electron',
  'vite',
  'express',
] as const;
export type FrameworkId = (typeof FRAMEWORK_IDS)[number];

export const FrameworkSchema = z.object({
  id: z.enum(FRAMEWORK_IDS),
  /** The declared range's lowest major; null for tags, protocols (workspace:, npm:, file:) and `*`. */
  major: z.number().int().nullable(),
});
export type Framework = z.infer<typeof FrameworkSchema>;

export const MonorepoSchema = z.object({
  /** Script names that two or more workspace packages define (plain words only, at most 20). */
  shared: z.array(z.string()),
  /** turbo.json's task names (plain, without `#`) when turbo is a root dependency. */
  turbo: z.array(z.string()),
  /** Yarn 2+ (`.yarnrc.yml` at the root) runs a script everywhere with `workspaces foreach`. */
  yarnBerry: z.boolean(),
  /** An Nx root's targets for `nx run-many`: nx.json's targetDefaults and the projects' targets. */
  nx: z.array(z.string()),
});
export type Monorepo = z.infer<typeof MonorepoSchema>;

/** A project of an Nx workspace: its Nx name and the targets its project.json lists. */
export const NxProjectSchema = z.object({
  project: z.string().min(1),
  targets: z.array(z.string()),
});
export type NxProject = z.infer<typeof NxProjectSchema>;

export const PACKAGE_MANAGER_SOURCES = ['lockfile', 'packageManager', 'default'] as const;
export type PackageManagerSource = (typeof PACKAGE_MANAGER_SOURCES)[number];

/**
 * Node.js project info: the package's name and scripts, which package manager runs it, and what it is built with.
 */
export const NodeInfoSchema = z.object({
  /** package.json's name, else the Nx project's; null when there's none (or a blank one). */
  name: z.string().min(1).nullable(),
  /** The folder has its own package.json (false for an Nx project with only a project.json). */
  packageJson: z.boolean(),
  /** package.json's scripts with string values. */
  scripts: z.record(z.string(), z.string()),
  /** From the lockfile, else package.json's packageManager field, else npm. */
  packageManager: z.enum(PACKAGE_MANAGERS),
  packageManagerSource: z.enum(PACKAGE_MANAGER_SOURCES),
  /** The lockfile names in the folder that decided (the root's for a workspace package when it has any). */
  lockfiles: z.array(z.string()),
  /** From dependency names (Next.js before Vite, …); null when none is known. */
  framework: FrameworkSchema.nullable(),
  /** Where the dev server listens: ports the dev/start scripts name, then the framework's default. */
  ports: z.array(z.number().int().min(1).max(65_535)),
  /** package.json lists dependencies or devDependencies (so there is something to install). */
  hasDependencies: z.boolean(),
  /** A root that declares workspaces: scripts its packages share, turbo.json's tasks. Null elsewhere. */
  monorepo: MonorepoSchema.nullable(),
  /** The folder's Nx project (a project.json under an Nx root); null elsewhere. */
  nx: NxProjectSchema.nullable(),
});
export type NodeInfo = z.infer<typeof NodeInfoSchema>;

const parsed = new WeakMap<object, NodeInfo | null>();

/** The package's Node info (a readable package.json); null when it isn't a Node package. */
export function nodeOf(project: Pick<DetectedProject, 'ecosystems'>): NodeInfo | null {
  const info = project.ecosystems.find((e) => e.id === 'node')?.info;
  if (typeof info !== 'object' || info === null) return null;
  const cached = parsed.get(info);
  if (cached !== undefined) return cached;
  const result = NodeInfoSchema.safeParse(info);
  const node = result.success ? result.data : null;
  parsed.set(info, node);
  return node;
}

/** The manager for display: `npm (default)` when no lockfile or packageManager field names one. */
export function packageManagerLabel(node: NodeInfo): string {
  return node.packageManagerSource === 'default'
    ? `${node.packageManager} (default)`
    : node.packageManager;
}
