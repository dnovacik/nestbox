import { describe, expect, it } from 'vitest';
import { conflictingSources, parsePackageManager, parseRequirement, satisfies } from './versions';

describe('parseRequirement', () => {
  it('reads version files: plain, v-prefixed and partial versions', () => {
    expect(parseRequirement('nvmrc', '20\n')).toEqual({ range: '>=20.0.0 <21.0.0-0', fnmVersion: '20' });
    expect(parseRequirement('node-version', 'v20.11.1')).toEqual({ range: '20.11.1', fnmVersion: '20.11.1' });
    expect(parseRequirement('nvmrc', '  22.4 \n# comment')).toEqual({ range: '>=22.4.0 <22.5.0-0', fnmVersion: '22.4' });
  });

  it('maps LTS codenames to their major and leaves aliases unresolved', () => {
    expect(parseRequirement('nvmrc', 'lts/iron')).toEqual({ range: '>=20.0.0 <21.0.0-0', fnmVersion: 'lts/iron' });
    expect(parseRequirement('nvmrc', 'lts/Jod')).toEqual({ range: '>=22.0.0 <23.0.0-0', fnmVersion: 'lts/jod' });
    expect(parseRequirement('nvmrc', 'lts/*')).toEqual({ range: null, fnmVersion: 'lts/*' });
    expect(parseRequirement('nvmrc', 'node')).toEqual({ range: null, fnmVersion: null });
  });

  it('reads engines ranges, with the lowest major for fnm', () => {
    expect(parseRequirement('engines', '>=20.11 <23')).toEqual({ range: '>=20.11.0 <23.0.0-0', fnmVersion: '20' });
    expect(parseRequirement('engines', '^18 || ^20')).toMatchObject({ fnmVersion: '18' });
    expect(parseRequirement('volta', '20.11.1')).toEqual({ range: '20.11.1', fnmVersion: '20.11.1' });
  });

  it('gives fnm only plain version tokens (they go on a command line)', () => {
    expect(parseRequirement('volta', '20 || 22')).toEqual({ range: '>=20.0.0 <21.0.0-0||>=22.0.0 <23.0.0-0', fnmVersion: null });
    expect(parseRequirement('nvmrc', '>=20')).toMatchObject({ fnmVersion: null });
  });

  it('refuses junk and empty values', () => {
    expect(parseRequirement('nvmrc', '')).toBe('invalid');
    expect(parseRequirement('engines', 'banana')).toBe('invalid');
    expect(parseRequirement('nvmrc', 'lts/unknown-codename')).toBe('invalid');
  });
});

describe('conflictingSources', () => {
  it('marks the sources that disagree with the first one', () => {
    expect(
      conflictingSources([
        { kind: 'nvmrc', range: '18.x' },
        { kind: 'engines', range: '>=20.0.0' },
        { kind: 'volta', range: '18.19.0' },
      ]),
    ).toEqual(['engines']);
    expect(
      conflictingSources([
        { kind: 'nvmrc', range: null },
        { kind: 'engines', range: '>=20.0.0' },
        { kind: 'volta', range: '18.19.0' },
      ]),
    ).toEqual(['volta']);
    expect(conflictingSources([{ kind: 'engines', range: '>=20.0.0' }])).toEqual([]);
  });
});

describe('satisfies', () => {
  it('compares a version with a range, prereleases included', () => {
    expect(satisfies('v20.11.1', '>=20.0.0')).toBe(true);
    expect(satisfies('18.19.0', '20.x')).toBe(false);
    expect(satisfies('23.0.0-nightly', '>=20.0.0')).toBe(true);
    expect(satisfies('garbage', '>=20.0.0')).toBe(false);
  });
});

describe('parsePackageManager', () => {
  it('splits name and version and drops the hash', () => {
    expect(parsePackageManager('pnpm@10.30.2+sha512.abcdef')).toEqual({ name: 'pnpm', version: '10.30.2' });
    expect(parsePackageManager('npm@10.9.0')).toEqual({ name: 'npm', version: '10.9.0' });
    expect(parsePackageManager('yarn@4.5.1')).toEqual({ name: 'yarn', version: '4.5.1' });
  });

  it('refuses other tools, ranges and junk', () => {
    expect(parsePackageManager('deno@2.0.0')).toBeNull();
    expect(parsePackageManager('pnpm@^10')).toBeNull();
    expect(parsePackageManager('pnpm')).toBeNull();
    expect(parsePackageManager(42)).toBeNull();
  });
});
