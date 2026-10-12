// EF Core's --prefix-output lines and its `migrations list --json` result. EF output can carry the connection
// string (errors, warnings), so it stays in memory: only the list's ids, names and applied flags leave here.
import { type EfMigration, EfMigrationSchema } from '@shared/tools/database/contract';

/** EF's own line prefixes, padded to 9 characters. The app's logging (`info: Microsoft…`) has none. */
const PREFIXES = ['error:   ', 'warn:    ', 'info:    ', 'data:    ', 'verbose: '];
const MAX_MIGRATIONS = 1_000;

/** A line without EF's prefix; data lines are EF's result (the list's JSON, a script's SQL). */
export function efLine(line: string): { data: boolean; text: string } {
  for (const prefix of PREFIXES) {
    if (line.startsWith(prefix) || line === prefix.trimEnd()) {
      return { data: prefix.startsWith('data'), text: line.slice(prefix.length) };
    }
  }
  return { data: false, text: line };
}

/** The list from its data lines; rows that don't fit the schema are dropped; null when it isn't a JSON array. */
export function parseMigrationList(data: string[]): EfMigration[] | null {
  let json: unknown;
  try {
    json = JSON.parse(data.join('\n'));
  } catch {
    return null;
  }
  if (!Array.isArray(json)) return null;
  return json
    .flatMap((row: unknown) => {
      const parsed = EfMigrationSchema.safeParse(row);
      return parsed.success
        ? [{ id: parsed.data.id, name: parsed.data.name, applied: parsed.data.applied }]
        : [];
    })
    .slice(0, MAX_MIGRATIONS);
}

/** The local tool manifest names dotnet-ef but it isn't restored yet. */
export const mentionsRestore = (output: string): boolean => output.includes('dotnet tool restore');
