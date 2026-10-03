// Reads the datasource block of a Prisma schema: which provider, and which env variable holds the URL.
// A literal url = "…" is only flagged, never returned.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface Datasource {
  provider: string | null;
  /** The variable in url = env("…"); null for a literal url or none (Prisma 7 keeps it in prisma.config.ts). */
  env: string | null;
  literal: boolean;
}

const MAX_SCHEMA_BYTES = 1024 * 1024;
const MAX_SCHEMA_FILES = 200;

export function parseDatasource(text: string): Datasource | null {
  const uncommented = text.replace(/\/\/[^\n]*/g, '');
  const block = /datasource\s+\w+\s*\{([^}]*)\}/.exec(uncommented)?.[1];
  if (block === undefined) return null;
  const provider = /^\s*provider\s*=\s*"([^"]*)"/m.exec(block)?.[1] ?? null;
  const url = /^\s*url\s*=\s*(.+)$/m.exec(block)?.[1]?.trim() ?? null;
  const env = url === null ? null : (/^env\(\s*"([^"]+)"\s*\)/.exec(url)?.[1] ?? null);
  return { provider, env, literal: url !== null && env === null };
}

/** Every .prisma file under a schema folder (multi-file schemas), depth-first, capped. */
async function schemaFiles(dir: string, out: string[] = [], depth = 0): Promise<string[]> {
  if (depth > 4) return out;
  for (const d of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (out.length >= MAX_SCHEMA_FILES) break;
    const path = join(dir, d.name);
    if (d.isDirectory()) await schemaFiles(path, out, depth + 1);
    else if (d.isFile() && d.name.endsWith('.prisma')) out.push(path);
  }
  return out;
}

/** The datasource of a schema file or folder; null when there is none or it can't be read. */
export async function readDatasource(schemaPath: string): Promise<Datasource | null> {
  const info = await stat(schemaPath).catch(() => null);
  if (!info) return null;
  const files = info.isDirectory() ? await schemaFiles(schemaPath) : [schemaPath];
  for (const file of files) {
    const size = (await stat(file).catch(() => null))?.size ?? Infinity;
    if (size > MAX_SCHEMA_BYTES) continue;
    const parsed = parseDatasource(await readFile(file, 'utf8').catch(() => ''));
    if (parsed) return parsed;
  }
  return null;
}
