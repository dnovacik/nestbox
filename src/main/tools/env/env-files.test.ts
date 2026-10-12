import { mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConfigFileAccess, createEnvFileAccess, MAX_ENV_FILE_BYTES } from './env-files';

let dir = '';
const files = createEnvFileAccess();

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nestbox-env-'));
});
afterEach(async () => rm(dir, { recursive: true, force: true }));

describe('env file access', () => {
  it('reads text with a version, and writes back when the version matches', async () => {
    await writeFile(join(dir, '.env'), 'A=1\n');
    const { text, version } = await files.read(dir, '.env');
    expect(text).toBe('A=1\n');
    const written = await files.write(dir, '.env', 'A=2\n', version);
    expect(await readFile(join(dir, '.env'), 'utf8')).toBe('A=2\n');
    expect(written.version).not.toBe(version);
    expect((await readdir(dir)).sort()).toEqual(['.env']);
  });

  it('refuses a write based on an older version (CONFLICT), leaving the file alone', async () => {
    await writeFile(join(dir, '.env'), 'A=1\n');
    const { version } = await files.read(dir, '.env');
    await writeFile(join(dir, '.env'), 'A=1\nB=2\n');
    await utimes(join(dir, '.env'), new Date(), new Date(Date.now() + 5_000));
    await expect(files.write(dir, '.env', 'A=9\n', version)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await readFile(join(dir, '.env'), 'utf8')).toBe('A=1\nB=2\n');
  });

  it('creates a file only when asked to (expected version null) and it does not exist', async () => {
    await files.write(dir, '.env.local', 'X=1\n', null);
    expect(await readFile(join(dir, '.env.local'), 'utf8')).toBe('X=1\n');
    await expect(files.write(dir, '.env.local', 'X=2\n', null)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('overwrites without a version check when told to', async () => {
    await writeFile(join(dir, '.env.backup'), 'old');
    await files.write(dir, '.env.backup', 'new', 'any');
    expect(await readFile(join(dir, '.env.backup'), 'utf8')).toBe('new');
  });

  it.each(['env', '.envrc', '../.env', '.env/../x', 'sub/.env', '.env\\x', '', '.env\0'])('rejects the name %j', async (name) => {
    await expect(files.read(dir, name)).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(files.write(dir, name, '', null)).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('lists env files live, marking symlinks read-only, ignoring folders and other names', async (ctx) => {
    await writeFile(join(dir, '.env'), '');
    await writeFile(join(dir, '.env.local'), '');
    await writeFile(join(dir, '.envrc'), '');
    await writeFile(join(dir, 'real.env'), '');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(dir, '.env.d'));
    let linked = true;
    try {
      await symlink(join(dir, 'real.env'), join(dir, '.env.shared'), 'file');
    } catch {
      linked = false;
    }
    const listed = await files.list(dir);
    expect(listed.filter((f) => f.name !== '.env.shared')).toEqual([
      { name: '.env', readOnly: false },
      { name: '.env.local', readOnly: false },
    ]);
    if (!linked) ctx.skip();
    expect(listed.find((f) => f.name === '.env.shared')).toEqual({ name: '.env.shared', readOnly: true });
  });

  it('lists nothing for a folder that is gone', async () => {
    expect(await files.list(join(dir, 'missing'))).toEqual([]);
  });

  it('reports a missing file as NOT_FOUND', async () => {
    await expect(files.read(dir, '.env')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('treats symlinks as read-only', async (ctx) => {
    await writeFile(join(dir, 'real.env'), 'A=1\n');
    try {
      await symlink(join(dir, 'real.env'), join(dir, '.env'), 'file');
    } catch {
      ctx.skip();
    }
    expect((await files.read(dir, '.env')).text).toBe('A=1\n');
    const { version } = await files.read(dir, '.env');
    await expect(files.write(dir, '.env', 'A=2\n', version)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses files over the size limit', async () => {
    await writeFile(join(dir, '.env'), 'A='.padEnd(MAX_ENV_FILE_BYTES + 10, 'x'));
    await expect(files.read(dir, '.env')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(files.write(dir, '.env.big', 'A='.padEnd(MAX_ENV_FILE_BYTES + 10, 'x'), null)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('never puts file contents in errors', async () => {
    await writeFile(join(dir, '.env'), 'SECRET=hunter2\n');
    const { version } = await files.read(dir, '.env');
    await writeFile(join(dir, '.env'), 'SECRET=hunter3\n');
    await utimes(join(dir, '.env'), new Date(), new Date(Date.now() + 5_000));
    const error = await files.write(dir, '.env', 'SECRET=hunter4\n', version).catch((e: unknown) => e);
    expect(String((error as Error).message)).not.toMatch(/hunter/);
  });
});

describe('settings file access', () => {
  const config = createConfigFileAccess();

  it('lists appsettings*.json only and refuses other names', async () => {
    for (const name of ['appsettings.json', 'appsettings.Development.json', 'appsettings.json.bak', 'launchSettings.json', 'appsettings..json']) {
      await writeFile(join(dir, name), '{}');
    }
    expect((await config.list(dir)).map((f) => f.name)).toEqual(['appsettings.Development.json', 'appsettings.json']);
    await expect(config.read(dir, 'launchSettings.json')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(config.write(dir, '.env', '', null)).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('keeps a BOM and CRLF byte for byte through read and write', async () => {
    const text = '﻿{\r\n  "A": 1\r\n}\r\n';
    await writeFile(join(dir, 'appsettings.json'), text);
    const read = await config.read(dir, 'appsettings.json');
    expect(read.text).toBe(text);
    await config.write(dir, 'appsettings.json', read.text, read.version);
    expect(await readFile(join(dir, 'appsettings.json'))).toEqual(Buffer.from(text, 'utf8'));
  });
});
