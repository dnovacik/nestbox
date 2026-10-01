import { isRecord } from '@shared/is-record';

/** Transforms data from version N (its table key) to N + 1. schemaVersion is set by migrate(). */
export type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/**
 * v1 → v2 (M1): adds settings.trayIconTheme and turns run groups from `{ name, scripts: string[] }`
 * into package-aware `{ name, entries: { relPath, script }[] }`. Groups are fitted into the v2 limits,
 * and malformed ones dropped, rather than failing (and resetting) the whole store.
 */
const migrateV1toV2: Migration = (data) => {
  const settings = isRecord(data['settings']) ? data['settings'] : {};
  const projects = Array.isArray(data['projects']) ? data['projects'] : [];
  return {
    ...data,
    settings: { trayIconTheme: 'dark-taskbar', ...settings },
    projects: projects.map((project: unknown) => {
      if (!isRecord(project)) return project; // validation decides
      const groups: unknown[] = Array.isArray(project['runGroups']) ? project['runGroups'] : [];
      return {
        ...project,
        runGroups: groups.flatMap((group) => {
          if (!isRecord(group) || typeof group['name'] !== 'string' || !Array.isArray(group['scripts'])) return [];
          // v2 limits (RunGroupSchema): trimmed name of 1–60 characters, at most 50 entries of ≤ 200 characters.
          const name = group['name'].trim().slice(0, 60).trim();
          if (name === '') return [];
          const scripts = group['scripts']
            .filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= 200)
            .slice(0, 50);
          return [{ name, entries: scripts.map((script) => ({ relPath: '', script })) }];
        }),
      };
    }),
  };
};

/** Real migrations, keyed by from-version. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = { 1: migrateV1toV2 };

export class MigrationError extends Error {
  override name = 'MigrationError';
}

/** The store was written by a newer Nestbox. It is opened read-only, never reset. */
export class NewerSchemaError extends MigrationError {
  override name = 'NewerSchemaError';
}

export function migrate(
  raw: unknown,
  target: number,
  table: Readonly<Record<number, Migration>> = MIGRATIONS,
): unknown {
  if (!isRecord(raw)) throw new MigrationError('Store root is not an object');
  const version = raw['schemaVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new MigrationError('Store has no schemaVersion');
  }
  if (version > target) {
    throw new NewerSchemaError(`Store schemaVersion ${version} is newer than supported ${target}`);
  }
  let data: Record<string, unknown> = raw;
  for (let v = version; v < target; v++) {
    const step = table[v];
    if (!step) throw new MigrationError(`No migration from v${v}`);
    data = { ...step(data), schemaVersion: v + 1 };
  }
  return data;
}
