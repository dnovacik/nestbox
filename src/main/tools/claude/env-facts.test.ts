import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEnvFileAccess } from '../env/env-files';
import { readEnvFacts } from './env-facts';

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nestbox-env-facts-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('readEnvFacts', () => {
  it('returns PORT and the example key names, never other values', async () => {
    await writeFile(join(dir, '.env'), 'PORT=3001\nSECRET=hunter2\n');
    await writeFile(join(dir, '.env.example'), 'DATABASE_URL=postgres://u:pw@db/x\nPORT=3000\nDATABASE_URL=again\n');
    const facts = await readEnvFacts(createEnvFileAccess(), dir, ['.env', '.env.example']);
    expect(facts).toEqual({ port: 3001, envKeys: ['DATABASE_URL', 'PORT'] });
    expect(JSON.stringify(facts)).not.toMatch(/hunter2|postgres|again/);
  });

  it('copes with missing files and a PORT that is not a port', async () => {
    await writeFile(join(dir, '.env'), 'PORT=abc\n');
    expect(await readEnvFacts(createEnvFileAccess(), dir, ['.env'])).toEqual({ port: null, envKeys: [] });
    expect(await readEnvFacts(createEnvFileAccess(), dir, ['.env', '.env.example'])).toEqual({ port: null, envKeys: [] });
  });
});
