import { describe, expect, it } from 'vitest';
import { buildConfigMatrix, type ConfigMatrixFile } from './config-matrix';

const SECRET = 'Password=s3cr3t';
const file = (name: string, text: string | null, readOnly = false): ConfigMatrixFile => ({
  name,
  version: text === null ? null : 'v1',
  readOnly,
  text,
});
const opts = { dotnet: true, truncated: false };

describe('buildConfigMatrix', () => {
  it('orders columns, merges keys case-insensitively and never carries values', () => {
    const m = buildConfigMatrix(
      [
        file(
          'appsettings.Development.json',
          `{"logging": {"loglevel": {"default": "Debug"}}, "Dev": ""}`,
        ),
        file(
          'appsettings.json',
          `{"Logging": {"LogLevel": {"Default": "Information"}}, "ConnectionStrings": {"Db": "${SECRET}"}}`,
        ),
      ],
      [],
      opts,
    );
    expect(m.files.map((f) => f.name)).toEqual([
      'appsettings.json',
      'appsettings.Development.json',
    ]);
    expect(m.keys).toEqual([
      {
        key: 'Logging:LogLevel:Default',
        cells: { 'appsettings.json': 'set', 'appsettings.Development.json': 'set' },
        overridden: true,
        envOnly: false,
      },
      {
        key: 'ConnectionStrings:Db',
        cells: { 'appsettings.json': 'set', 'appsettings.Development.json': 'absent' },
        overridden: false,
        envOnly: false,
      },
      {
        key: 'Dev',
        cells: { 'appsettings.json': 'absent', 'appsettings.Development.json': 'empty' },
        overridden: false,
        envOnly: true,
      },
    ]);
    expect(JSON.stringify(m)).not.toContain('s3cr3t');
    expect(JSON.stringify(m)).not.toContain('Information');
  });

  it('lists invalid and too-large files without reading their keys', () => {
    const big = `{${Array.from({ length: 2001 }, (_, i) => `"K${i}": 1`).join(',')}}`;
    const m = buildConfigMatrix(
      [
        file('appsettings.json', '{ "A": '),
        file('appsettings.Big.json', big),
        file('appsettings.Huge.json', null),
      ],
      [],
      opts,
    );
    expect(m.files).toEqual([
      expect.objectContaining({
        name: 'appsettings.json',
        invalid: true,
        tooLarge: false,
        entries: 0,
      }),
      expect.objectContaining({
        name: 'appsettings.Big.json',
        invalid: false,
        tooLarge: true,
        entries: 0,
      }),
      expect.objectContaining({
        name: 'appsettings.Huge.json',
        invalid: false,
        tooLarge: true,
        version: null,
      }),
    ]);
    expect(m.keys).toEqual([]);
  });

  it('reports case duplicates and flags no envOnly without a base file', () => {
    const m = buildConfigMatrix(
      [file('appsettings.Production.json', '{"Port": 1, "PORT": 2}')],
      [],
      opts,
    );
    expect(m.files[0]?.caseDuplicates).toEqual(['Port']);
    expect(m.keys).toEqual([
      {
        key: 'Port',
        cells: { 'appsettings.Production.json': 'set' },
        overridden: false,
        envOnly: false,
      },
    ]);
  });

  it('maps profiles to their environment files, matching names case-insensitively', () => {
    const m = buildConfigMatrix(
      [file('appsettings.json', '{}'), file('appsettings.development.json', '{}')],
      [
        { name: 'http', environment: 'Development' },
        { name: 'prod', environment: 'Production' },
      ],
      opts,
    );
    expect(m.profiles).toEqual([
      {
        name: 'http',
        environment: 'Development',
        file: 'appsettings.development.json',
        exists: true,
      },
      {
        name: 'prod',
        environment: 'Production',
        file: 'appsettings.Production.json',
        exists: false,
      },
    ]);
  });
});
