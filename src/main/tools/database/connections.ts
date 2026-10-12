// ConnectionStrings:<Name> from appsettings*.json, the way .NET layers them for one environment:
// appsettings.<Environment>.json over appsettings.json, names matched ignoring case. The values stay in
// main: callers describe them with describeConnectionString and drop them.
import { findLeaf, leafValue, parseConfig, type ConfigLeaf } from '../env/appsettings';
import type { ConfigFileAccess } from '../env/env-files';

export const MAX_CONNECTIONS = 20;
const BASE = 'appsettings.json';
const SECTION = 'connectionstrings:';
const DEFAULT_ENVIRONMENT = 'Production';

export interface ConnectionValue {
  /** In the first file's spelling. */
  name: string;
  /** The file the value comes from. */
  file: string;
  /** null when it isn't a text value (or is empty). */
  value: string | null;
}

/** Profile environments, then appsettings.<Name>.json files, then Production; no duplicates ignoring case. */
export function environmentsFor(
  profiles: readonly { environment: string }[],
  fileNames: readonly string[],
): string[] {
  const fromFiles = fileNames
    .map((n) => /^appsettings\.(.+)\.json$/.exec(n)?.[1])
    .filter((e): e is string => e !== undefined);
  const out: string[] = [];
  for (const env of [...profiles.map((p) => p.environment), ...fromFiles, DEFAULT_ENVIRONMENT]) {
    if (!out.some((e) => e.toLowerCase() === env.toLowerCase())) out.push(env);
  }
  return out;
}

/** The ConnectionStrings leaves of one file (one level deep), or null when it can't be read. */
async function read(dir: string, files: Pick<ConfigFileAccess, 'read'>, name: string) {
  const text = await files
    .read(dir, name)
    .then((r) => r.text)
    .catch(() => null);
  const leaves = text === null ? null : parseConfig(text);
  if (text === null || leaves === null) return null;
  const names: string[] = [];
  for (const leaf of leaves) {
    const rest = leaf.key.slice(SECTION.length);
    if (
      leaf.key.toLowerCase().startsWith(SECTION) &&
      rest !== '' &&
      !rest.includes(':') &&
      !names.some((n) => n.toLowerCase() === rest.toLowerCase())
    ) {
      names.push(rest);
    }
  }
  const valueOf = (leaf: ConfigLeaf) =>
    leaf.type === 'string' && !leaf.empty ? leafValue(text, leaf) : null;
  return names.map((n) => {
    const leaf = findLeaf(leaves, `ConnectionStrings:${n}`);
    return { name: n, file: name, value: leaf ? valueOf(leaf) : null };
  });
}

export async function readConnections(
  dir: string,
  files: Pick<ConfigFileAccess, 'list' | 'read'>,
  environment: string,
): Promise<{ connections: ConnectionValue[]; truncated: boolean }> {
  const listed = (await files.list(dir)).map((f) => f.name);
  const envFile = listed.find(
    (n) => n.toLowerCase() === `appsettings.${environment}.json`.toLowerCase(),
  );
  const base = listed.includes(BASE) ? ((await read(dir, files, BASE)) ?? []) : [];
  const overlay = envFile ? ((await read(dir, files, envFile)) ?? []) : [];
  const merged: ConnectionValue[] = [...base];
  for (const c of overlay) {
    const at = merged.findIndex((m) => m.name.toLowerCase() === c.name.toLowerCase());
    if (at === -1) merged.push(c);
    else merged[at] = { ...c, name: merged[at]?.name ?? c.name };
  }
  return {
    connections: merged.slice(0, MAX_CONNECTIONS),
    truncated: merged.length > MAX_CONNECTIONS,
  };
}
