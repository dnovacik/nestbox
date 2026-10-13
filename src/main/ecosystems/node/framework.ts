// Which framework a Node package is built with, from its dependency names (package.json, never node_modules).
// The project card names it, and its default dev port feeds Health and the Inspector.
import semver from 'semver';
import { z } from 'zod';

/** In priority order: a framework before the tools it builds on (Next before Vite, NestJS before Express). */
const FRAMEWORKS = [
  { id: 'next', label: 'Next.js', matches: (name: string) => name === 'next' },
  { id: 'nuxt', label: 'Nuxt', matches: (name: string) => name === 'nuxt' },
  { id: 'remix', label: 'Remix', matches: (name: string) => name.startsWith('@remix-run/') },
  { id: 'astro', label: 'Astro', matches: (name: string) => name === 'astro' },
  { id: 'sveltekit', label: 'SvelteKit', matches: (name: string) => name === '@sveltejs/kit' },
  { id: 'nestjs', label: 'NestJS', matches: (name: string) => name === '@nestjs/core' },
  { id: 'electron', label: 'Electron', matches: (name: string) => name === 'electron' },
  { id: 'vite', label: 'Vite', matches: (name: string) => name === 'vite' },
  { id: 'express', label: 'Express', matches: (name: string) => name === 'express' },
] as const;

export const FRAMEWORK_IDS = FRAMEWORKS.map((f) => f.id) as [
  (typeof FRAMEWORKS)[number]['id'],
  ...(typeof FRAMEWORKS)[number]['id'][],
];
export type FrameworkId = (typeof FRAMEWORKS)[number]['id'];

export const FrameworkSchema = z.object({
  id: z.enum(FRAMEWORK_IDS),
  /** The declared range's lowest major; null for tags, protocols (workspace:, npm:, file:) and `*`. */
  major: z.number().int().nullable(),
});
export type Framework = z.infer<typeof FrameworkSchema>;

function dependencyRanges(json: Record<string, unknown> | null): Map<string, unknown> {
  const ranges = new Map<string, unknown>();
  for (const field of ['dependencies', 'devDependencies']) {
    const deps = json?.[field];
    if (!deps || typeof deps !== 'object' || Array.isArray(deps)) continue;
    for (const [name, range] of Object.entries(deps))
      if (!ranges.has(name)) ranges.set(name, range);
  }
  return ranges;
}

function majorOf(range: unknown): number | null {
  if (typeof range !== 'string' || range.trim() === '') return null;
  try {
    const min = semver.minVersion(range);
    return min && min.version !== '0.0.0' ? min.major : null;
  } catch {
    return null;
  }
}

/** The package's framework from package.json's dependencies and devDependencies; null when none is known. */
export function detectFramework(json: Record<string, unknown> | null): Framework | null {
  const ranges = dependencyRanges(json);
  for (const framework of FRAMEWORKS) {
    const name = [...ranges.keys()].find(framework.matches);
    if (name !== undefined) return { id: framework.id, major: majorOf(ranges.get(name)) };
  }
  return null;
}

/** "Next.js 15", or the name alone without a major. */
export function frameworkLabel(framework: Framework): string {
  const label = FRAMEWORKS.find((f) => f.id === framework.id)?.label ?? framework.id;
  return framework.major === null ? label : `${label} ${framework.major}`;
}
