import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTree, removeTree } from '../../detection/test-fixtures';
import { createEnvFileAccess } from '../env/env-files';
import { findUrl } from './source';

let dir = '';
afterEach(async () => removeTree(dir));
const files = createEnvFileAccess();

describe('findUrl', () => {
  it('reads the package .env first', async () => {
    dir = await makeTree({ '.env': 'DATABASE_URL="postgresql://a@x/one"\n', 'prisma/.env': 'DATABASE_URL=postgresql://a@x/two\n' });
    expect(await findUrl(dir, 'DATABASE_URL', files)).toEqual({ value: 'postgresql://a@x/one', source: '.env' });
  });

  it('falls back to prisma/.env', async () => {
    dir = await makeTree({ '.env': 'PORT=3000\n', 'prisma/.env': 'DATABASE_URL=postgresql://a@x/two\n' });
    expect(await findUrl(dir, 'DATABASE_URL', files)).toEqual({ value: 'postgresql://a@x/two', source: 'prisma/.env' });
  });

  it('returns null when no file has the key, or it is empty', async () => {
    dir = await makeTree({ '.env': 'DATABASE_URL=\n' });
    expect(await findUrl(dir, 'DATABASE_URL', files)).toBeNull();
    await mkdir(join(dir, 'prisma'));
    await writeFile(join(dir, 'prisma', '.env'), 'OTHER=1\n');
    expect(await findUrl(dir, 'DATABASE_URL', files)).toBeNull();
  });
});
