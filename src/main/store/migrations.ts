import { isRecord } from '@shared/is-record';

/** Transforms data from version N (its table key) to N + 1. schemaVersion is set by migrate(). */
export type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/** Real migrations, keyed by from-version. Empty until the first schema change (M1: trayIconTheme). */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

export class MigrationError extends Error {
  override name = 'MigrationError';
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
    throw new MigrationError(`Store schemaVersion ${version} is newer than supported ${target}`);
  }
  let data: Record<string, unknown> = raw;
  for (let v = version; v < target; v++) {
    const step = table[v];
    if (!step) throw new MigrationError(`No migration from v${v}`);
    data = { ...step(data), schemaVersion: v + 1 };
  }
  return data;
}
