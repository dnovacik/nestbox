import type { EnvMatrix } from '@shared/tools/env/contract';
import { entries, duplicateKeys, type EnvDocument } from './dotenv';

const EXAMPLES = ['.env.example', '.env.sample', '.env.template'];
export const BACKUP_FILE = '.env.backup';

/** The example used for the missing/undocumented flags. */
export function exampleFile(names: readonly string[]): string | null {
  return EXAMPLES.find((n) => names.includes(n)) ?? null;
}

/** Profiles are .env.<name> files, except examples (also *.example) and the backup. */
export function profileFiles(names: readonly string[]): string[] {
  return names
    .filter((n) => n.startsWith('.env.') && !EXAMPLES.includes(n) && n !== BACKUP_FILE && !n.endsWith('.example'))
    .sort();
}

/** The profile whose bytes equal .env, or null. */
export function activeProfile(envText: string | null, profiles: readonly { file: string; text: string }[]): string | null {
  if (envText === null) return null;
  return profiles.find((p) => p.text === envText)?.file ?? null;
}

export interface MatrixFile {
  name: string;
  version: string;
  readOnly: boolean;
  doc: EnvDocument;
}

/** Keys × files with presence only: values never leave this function. */
export function buildMatrix(files: readonly MatrixFile[], active: string | null): EnvMatrix {
  const names = files.map((f) => f.name);
  const example = exampleFile(names);
  const columns = [...files].sort((a, b) => rank(a.name, example) - rank(b.name, example) || a.name.localeCompare(b.name));
  const values = new Map(columns.map((f) => [f.name, entries(f.doc)]));

  const keys: string[] = [];
  for (const f of columns) for (const key of values.get(f.name)?.keys() ?? []) if (!keys.includes(key)) keys.push(key);

  const env = values.get('.env');
  const documented = example ? values.get(example) : undefined;
  return {
    files: columns.map((f) => ({
      name: f.name,
      version: f.version,
      readOnly: f.readOnly,
      entries: values.get(f.name)?.size ?? 0,
      duplicates: duplicateKeys(f.doc),
    })),
    keys: keys.map((key) => ({
      key,
      cells: Object.fromEntries(
        columns.map((f) => {
          const value = values.get(f.name)?.get(key);
          return [f.name, value === undefined ? 'absent' : value === '' ? 'empty' : 'set'] as const;
        }),
      ),
      missing: env !== undefined && documented !== undefined && documented.has(key) && !env.has(key),
      undocumented: env !== undefined && documented !== undefined && env.has(key) && !documented.has(key),
    })),
    example,
    profiles: profileFiles(names).map((file) => ({ name: file.slice('.env.'.length), file, active: file === active })),
  };
}

function rank(name: string, example: string | null): number {
  if (name === example) return 0;
  if (name === '.env') return 1;
  return 2;
}
