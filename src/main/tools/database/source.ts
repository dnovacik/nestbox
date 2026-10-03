// Finds the database URL the way the Prisma CLI loads it: the package's .env, then prisma/.env.
// The value stays in main: callers describe it with describeUrl and drop it.
import { join } from 'node:path';
import { entries, parseEnv } from '../env/dotenv';
import type { EnvFileAccess } from '../env/env-files';

export type UrlSource = '.env' | 'prisma/.env';

export async function findUrl(
  dir: string,
  variable: string,
  files: Pick<EnvFileAccess, 'read'>,
): Promise<{ value: string; source: UrlSource } | null> {
  const places: [string, UrlSource][] = [
    [dir, '.env'],
    [join(dir, 'prisma'), 'prisma/.env'],
  ];
  for (const [folder, source] of places) {
    const text = await files
      .read(folder, '.env')
      .then((r) => r.text)
      .catch(() => null);
    const value = text === null ? undefined : entries(parseEnv(text)).get(variable);
    if (value) return { value, source };
  }
  return null;
}
