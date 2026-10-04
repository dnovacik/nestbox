// Node version requirements: what the version files and package.json ask for, whether they agree, and the
// packageManager field. Pure, so the tool and its tests share it.
import semver from 'semver';
import { PACKAGE_MANAGERS, type PackageManager } from '@shared/detected';
import type { SourceKind } from '@shared/tools/node/contract';

export interface Requirement {
  /** A normalised semver range, or null for an alias that can't be resolved offline (`lts/*`, `node`). */
  range: string | null;
  /** What `fnm exec --using=` gets, or null when fnm can't use it. */
  fnmVersion: string | null;
}

/** LTS codenames (as nvm and fnm spell them) and their majors. */
const LTS: Record<string, number> = {
  argon: 4,
  boron: 6,
  carbon: 8,
  dubnium: 10,
  erbium: 12,
  fermium: 14,
  gallium: 16,
  hydrogen: 18,
  iron: 20,
  jod: 22,
  krypton: 24,
};
const ALIASES = new Set(['node', 'stable', 'latest', 'current']);

/** A source's value as a requirement, or 'invalid' when it is neither a version, a range nor a known alias. */
export function parseRequirement(kind: SourceKind, text: string): Requirement | 'invalid' {
  // Version files hold one version on the first line; nvm allows trailing comments.
  const value = (
    kind === 'nvmrc' || kind === 'node-version' ? (text.split(/\r?\n/)[0] ?? '') : text
  ).trim();
  if (value === '') return 'invalid';
  const lower = value.toLowerCase();
  if (lower === 'lts/*') return { range: null, fnmVersion: 'lts/*' };
  if (lower.startsWith('lts/')) {
    const major = LTS[lower.slice(4)];
    return major === undefined
      ? 'invalid'
      : { range: semver.validRange(String(major)), fnmVersion: lower };
  }
  if (ALIASES.has(lower)) return { range: null, fnmVersion: null };
  const range = semver.validRange(value);
  if (range === null) return 'invalid';
  if (kind === 'engines') {
    const lowest = semver.minVersion(range);
    return { range, fnmVersion: lowest ? String(lowest.major) : null };
  }
  // fnm gets the text as written, so only a plain version: `20`, `20.11.1`, never a range like `20 || 22`.
  const plain = value.replace(/^v/i, '');
  return { range, fnmVersion: /^\d+(\.\d+){0,2}$/.test(plain) ? plain : null };
}

/** The sources that disagree with the requirement (the first source with a range). */
export function conflictingSources(
  sources: readonly { kind: SourceKind; range: string | null }[],
): SourceKind[] {
  const ranged = sources.filter((s): s is { kind: SourceKind; range: string } => s.range !== null);
  const [first, ...rest] = ranged;
  if (!first) return [];
  return rest
    .filter((s) => !semver.intersects(first.range, s.range, { includePrerelease: true }))
    .map((s) => s.kind);
}

export function satisfies(version: string, range: string): boolean {
  const clean = semver.valid(semver.clean(version) ?? '');
  return clean !== null && semver.satisfies(clean, range, { includePrerelease: true });
}

/** `pnpm@10.30.2+sha512.…` → name and exact version; null for anything else. */
export function parsePackageManager(
  field: unknown,
): { name: PackageManager; version: string } | null {
  if (typeof field !== 'string') return null;
  const match = /^([a-z]+)@([^+]+)(\+.*)?$/.exec(field.trim());
  if (!match) return null;
  const name = match[1] as PackageManager;
  const version = semver.valid(match[2] ?? '');
  return PACKAGE_MANAGERS.includes(name) && version !== null ? { name, version } : null;
}
