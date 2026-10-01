// What the context block may say about env files: PORT as a number, and key names from .env.example.
// Values are parsed in memory and dropped here; nothing else leaves this module.
import { entries, parseEnv } from '../env/dotenv';
import type { EnvFileAccess } from '../env/env-files';
import { portOf } from '../env';

export const ENV_EXAMPLE = '.env.example';

export async function readEnvFacts(
  files: Pick<EnvFileAccess, 'read'>,
  dir: string,
  envFiles: readonly string[],
): Promise<{ port: number | null; envKeys: string[] }> {
  const read = async (name: string) => (envFiles.includes(name) ? (await files.read(dir, name).catch(() => null))?.text ?? null : null);
  const env = await read('.env');
  const example = await read(ENV_EXAMPLE);
  return {
    port: env === null ? null : portOf(entries(parseEnv(env)).get('PORT')),
    envKeys: example === null ? [] : [...entries(parseEnv(example)).keys()],
  };
}
