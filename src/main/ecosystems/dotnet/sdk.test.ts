import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseListSdks, satisfies, sdkWarning } from './sdk';

// Real `dotnet --list-sdks` output (Windows, CRLF).
const LIST = readFileSync(join(__dirname, '__fixtures__', 'list-sdks.txt'), 'utf8');

describe('parseListSdks', () => {
  it('keeps the versions only', () => {
    expect(parseListSdks(LIST)).toEqual(['8.0.414', '10.0.401']);
    expect(parseListSdks('9.0.100-rc.1.24452.12 [/usr/share/dotnet/sdk]\n\n')).toEqual(['9.0.100-rc.1.24452.12']);
    expect(parseListSdks('')).toEqual([]);
  });
});

describe('satisfies', () => {
  it.each([
    // [required, policy, installed, ok]
    ['8.0.100', 'latestPatch', '8.0.100', true],
    ['8.0.100', 'latestPatch', '8.0.199', true],
    ['8.0.100', 'latestPatch', '8.0.200', false],
    ['8.0.414', 'patch', '8.0.400', false],
    ['8.0.100', 'latestFeature', '8.0.414', true],
    ['8.0.100', 'latestFeature', '8.1.100', false],
    ['8.0.100', 'latestMinor', '8.1.100', true],
    ['8.0.100', 'latestMinor', '9.0.100', false],
    ['8.0.100', 'latestMajor', '10.0.401', true],
    ['8.0.100', 'disable', '8.0.101', false],
    ['8.0.100', 'disable', '8.0.100', true],
    ['8.0.100', 'latestMajor', '10.0.100-rc.1', false],
    ['9.0.100-rc.1', 'latestPatch', '9.0.100-rc.1', true],
  ] as const)('%s with %s accepts %s: %s', (required, policy, installed, ok) => {
    expect(satisfies(required, policy, installed)).toBe(ok);
  });
});

describe('sdkWarning', () => {
  it('is null without global.json or when an SDK matches', () => {
    expect(sdkWarning(null, [])).toBeNull();
    expect(sdkWarning({ version: '8.0.400', rollForward: 'latestPatch' }, ['8.0.414', '10.0.401'])).toBeNull();
  });

  it('names the required and installed SDKs', () => {
    expect(sdkWarning({ version: '9.0.100', rollForward: 'latestFeature' }, ['8.0.414', '10.0.401'])).toBe(
      'global.json asks for .NET SDK 9.0.100 (rollForward latestFeature); installed: 8.0.414, 10.0.401',
    );
    expect(sdkWarning({ version: '9.0.100', rollForward: 'latestPatch' }, [])).toContain('installed: none');
  });
});
