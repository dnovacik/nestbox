import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConfigFileAccess } from '../env/env-files';
import { environmentsFor, MAX_CONNECTIONS, readConnections } from './connections';

let dir = '';
const files = createConfigFileAccess();
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nestbox-conn-'));
});
afterEach(async () => rm(dir, { recursive: true, force: true }));

const write = (name: string, text: string) => writeFile(join(dir, name), text);

describe('readConnections', () => {
  it('overlays the environment file on appsettings.json, ignoring case, and names the source file', async () => {
    await write(
      'appsettings.json',
      `{
  // base
  "ConnectionStrings": { "Shop": "Host=prod;Password=p", "Identity": "Host=id" },
  "Logging": { "LogLevel": { "Default": "Information" } }
}`,
    );
    await write(
      'appsettings.Development.json',
      '{ "connectionstrings": { "shop": "Host=localhost" }, "ConnectionStrings": { "Cache": "Host=redis" } }',
    );
    expect(await readConnections(dir, files, 'development')).toEqual({
      connections: [
        { name: 'Shop', file: 'appsettings.Development.json', value: 'Host=localhost' },
        { name: 'Identity', file: 'appsettings.json', value: 'Host=id' },
        { name: 'Cache', file: 'appsettings.Development.json', value: 'Host=redis' },
      ],
      truncated: false,
    });
    expect((await readConnections(dir, files, 'Production')).connections).toEqual([
      { name: 'Shop', file: 'appsettings.json', value: 'Host=prod;Password=p' },
      { name: 'Identity', file: 'appsettings.json', value: 'Host=id' },
    ]);
  });

  it('skips an invalid file and lists non-text or empty values without one', async () => {
    await write(
      'appsettings.json',
      '{ "ConnectionStrings": { "A": 42, "B": "", "C": "Host=x", "Nested": { "D": "Host=y" } } }',
    );
    await write('appsettings.Staging.json', '{ "ConnectionStrings": ');
    expect((await readConnections(dir, files, 'Staging')).connections).toEqual([
      { name: 'A', file: 'appsettings.json', value: null },
      { name: 'B', file: 'appsettings.json', value: null },
      { name: 'C', file: 'appsettings.json', value: 'Host=x' },
    ]);
  });

  it('returns nothing without appsettings files, and caps the list', async () => {
    expect(await readConnections(dir, files, 'Production')).toEqual({
      connections: [],
      truncated: false,
    });
    const many = Object.fromEntries(
      Array.from({ length: MAX_CONNECTIONS + 3 }, (_, i) => [`C${i}`, `Host=h${i}`]),
    );
    await write('appsettings.json', JSON.stringify({ ConnectionStrings: many }));
    const read = await readConnections(dir, files, 'Production');
    expect(read.connections).toHaveLength(MAX_CONNECTIONS);
    expect(read.truncated).toBe(true);
  });
});

describe('environmentsFor', () => {
  it('lists profile environments, then environment files, then Production, without duplicates', () => {
    expect(
      environmentsFor(
        [{ environment: 'Development' }, { environment: 'development' }, { environment: 'Local' }],
        [
          'appsettings.json',
          'appsettings.Staging.json',
          'appsettings.Development.json',
          'appsettings.production.json',
        ],
      ),
    ).toEqual(['Development', 'Local', 'Staging', 'production']);
    expect(environmentsFor([], [])).toEqual(['Production']);
  });
});
