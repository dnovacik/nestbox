import { describe, expect, it } from 'vitest';
import { parseEnv } from './dotenv';
import { activeProfile, buildMatrix, exampleFile, profileFiles } from './matrix';

const file = (name: string, text: string, readOnly = false) => ({ name, version: `v-${name}`, readOnly, doc: parseEnv(text) });

describe('profileFiles', () => {
  it('keeps .env.<name> files that are not examples or the backup', () => {
    expect(
      profileFiles(['.env', '.env.example', '.env.sample', '.env.template', '.env.backup', '.env.local.example', '.env.staging', '.env.local']),
    ).toEqual(['.env.local', '.env.staging']);
  });
});

describe('exampleFile', () => {
  it('prefers .env.example, then .env.sample, then .env.template', () => {
    expect(exampleFile(['.env', '.env.template', '.env.sample'])).toBe('.env.sample');
    expect(exampleFile(['.env'])).toBeNull();
  });
});

describe('activeProfile', () => {
  it('is the profile whose bytes equal .env', () => {
    const profiles = [
      { file: '.env.local', text: 'A=1\n' },
      { file: '.env.staging', text: 'A=2\n' },
    ];
    expect(activeProfile('A=2\n', profiles)).toBe('.env.staging');
    expect(activeProfile('A=2\r\n', profiles)).toBeNull();
    expect(activeProfile(null, profiles)).toBeNull();
  });
});

describe('buildMatrix', () => {
  const files = [
    file('.env.local', 'LOCAL_ONLY=1\n'),
    file('.env', 'PORT=3000\nDATABASE_URL=postgres://u:s3cr3t@h/db\nDEBUG=\nEXTRA=x\nPORT=3001\n'),
    file('.env.example', '# docs\nPORT=\nDATABASE_URL=\nREDIS_URL=\nDEBUG=\n'),
  ];

  it('orders columns example first, then .env, then the rest; keys by first appearance', () => {
    const m = buildMatrix(files, '.env.local');
    expect(m.files.map((f) => f.name)).toEqual(['.env.example', '.env', '.env.local']);
    expect(m.keys.map((k) => k.key)).toEqual(['PORT', 'DATABASE_URL', 'REDIS_URL', 'DEBUG', 'EXTRA', 'LOCAL_ONLY']);
    expect(m.example).toBe('.env.example');
  });

  it('marks cells as set, empty or absent', () => {
    const m = buildMatrix(files, null);
    const port = m.keys.find((k) => k.key === 'PORT');
    expect(port?.cells).toEqual({ '.env.example': 'empty', '.env': 'set', '.env.local': 'absent' });
    expect(m.keys.find((k) => k.key === 'DEBUG')?.cells['.env']).toBe('empty');
  });

  it('flags keys missing from .env and keys the example does not document', () => {
    const m = buildMatrix(files, null);
    const flags = Object.fromEntries(m.keys.map((k) => [k.key, [k.missing, k.undocumented]]));
    expect(flags).toEqual({
      PORT: [false, false],
      DATABASE_URL: [false, false],
      REDIS_URL: [true, false],
      DEBUG: [false, false],
      EXTRA: [false, true],
      LOCAL_ONLY: [false, false],
    });
  });

  it('does not flag anything without both .env and an example', () => {
    const m = buildMatrix([file('.env', 'A=1\n')], null);
    expect(m.keys).toEqual([{ key: 'A', cells: { '.env': 'set' }, missing: false, undocumented: false }]);
  });

  it('counts entries, lists duplicates, carries versions and read-only flags, and lists profiles', () => {
    const m = buildMatrix([...files, file('.env.staging', 'A=1\n', true)], '.env.staging');
    expect(m.files.find((f) => f.name === '.env')).toEqual({ name: '.env', version: 'v-.env', readOnly: false, entries: 4, duplicates: ['PORT'] });
    expect(m.files.find((f) => f.name === '.env.staging')?.readOnly).toBe(true);
    expect(m.profiles).toEqual([
      { name: 'local', file: '.env.local', active: false },
      { name: 'staging', file: '.env.staging', active: true },
    ]);
  });

  it('never contains a value', () => {
    expect(JSON.stringify(buildMatrix(files, null))).not.toMatch(/s3cr3t|3000|postgres/);
  });
});
