import type { ConfigMatrix } from '@shared/tools/env/contract';
import {
  caseDuplicates,
  configColumnRank,
  MAX_CONFIG_KEYS,
  parseConfig,
  type ConfigLeaf,
} from './appsettings';

export const BASE_CONFIG = 'appsettings.json';
export const MAX_CONFIG_FILES = 20;

export const configFileFor = (environment: string) => `appsettings.${environment}.json`;

export interface ConfigMatrixFile {
  name: string;
  /** null: too large to read. */
  version: string | null;
  readOnly: boolean;
  text: string | null;
}

/** Keys × settings files with presence only: values never leave this function. */
export function buildConfigMatrix(
  files: readonly ConfigMatrixFile[],
  profiles: readonly { name: string; environment: string }[],
  opts: { dotnet: boolean; truncated: boolean },
): ConfigMatrix {
  const columns = [...files].sort(
    (a, b) => configColumnRank(a.name) - configColumnRank(b.name) || a.name.localeCompare(b.name),
  );
  const parsed = columns.map((f) => {
    const leaves = f.text === null ? null : parseConfig(f.text);
    const tooLarge = f.text === null || (leaves !== null && leaves.length > MAX_CONFIG_KEYS);
    return {
      file: f,
      leaves: tooLarge ? null : leaves,
      tooLarge,
      invalid: !tooLarge && leaves === null,
    };
  });

  // One row per key ignoring case, in the spelling first seen (column order).
  const rows = new Map<string, string>();
  const cells = new Map<string, Map<string, ConfigLeaf>>();
  for (const p of parsed) {
    const byKey = new Map<string, ConfigLeaf>();
    for (const leaf of p.leaves ?? []) {
      const k = leaf.key.toLowerCase();
      if (!rows.has(k)) rows.set(k, leaf.key);
      byKey.set(k, leaf); // the last one wins, as in .NET
    }
    cells.set(p.file.name, byKey);
  }

  const hasBase = parsed.some((p) => p.file.name === BASE_CONFIG && p.leaves !== null);
  const names = columns.map((f) => f.name.toLowerCase());
  return {
    dotnet: opts.dotnet,
    files: parsed.map((p) => ({
      name: p.file.name,
      version: p.file.version,
      readOnly: p.file.readOnly,
      tooLarge: p.tooLarge,
      invalid: p.invalid,
      entries: p.leaves?.length ?? 0,
      caseDuplicates: p.leaves ? caseDuplicates(p.leaves) : [],
    })),
    keys: [...rows].map(([k, key]) => {
      const state = (file: string) => {
        const leaf = cells.get(file)?.get(k);
        return leaf === undefined ? 'absent' : leaf.empty ? 'empty' : 'set';
      };
      const envFiles = columns.filter((f) => f.name !== BASE_CONFIG && state(f.name) !== 'absent');
      const inBase = state(BASE_CONFIG) !== 'absent';
      return {
        key,
        cells: Object.fromEntries(columns.map((f) => [f.name, state(f.name)] as const)),
        overridden: inBase && envFiles.length > 0,
        envOnly: hasBase && !inBase && envFiles.length > 0,
      };
    }),
    profiles: profiles.map((p) => {
      const file = configFileFor(p.environment);
      const existing = columns.find((f) => f.name.toLowerCase() === file.toLowerCase());
      return {
        name: p.name,
        environment: p.environment,
        file: existing?.name ?? file,
        exists: names.includes(file.toLowerCase()),
      };
    }),
    truncated: opts.truncated,
  };
}
