import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { checkDotnet, dotnetRows, dotnetUpdateCommand, parseListPackage } from './deps';
import type { DotnetInfo } from './detect';
import { DOTNET_ENV } from './env';

// Real output of `dotnet list Shop.slnx package --outdated|--vulnerable --format json` (SDK 10.0.401),
// with the local folder replaced by C:/work/Shop.
const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');
const OUTDATED = fixture('list-outdated.json');
const VULNERABLE = fixture('list-vulnerable.json');
// The documented transitive shape (none of the sample's transitive packages had an advisory).
const TRANSITIVE = JSON.stringify({
  version: 1,
  parameters: '--vulnerable --include-transitive',
  projects: [
    {
      path: 'C:/work/Shop/src/Shop.Api/Shop.Api.csproj',
      frameworks: [
        {
          framework: 'net10.0',
          transitivePackages: [
            {
              id: 'System.Text.Json',
              resolvedVersion: '8.0.0',
              vulnerabilities: [
                {
                  severity: 'High',
                  advisoryurl: 'https://github.com/advisories/GHSA-hh2w-p6rv-4g7w',
                },
                { severity: 'Moderate', advisoryurl: 'javascript:alert(1)' },
              ],
            },
          ],
        },
      ],
    },
  ],
});

describe('parseListPackage', () => {
  it('reads every project and framework, keeping ids and versions only', () => {
    const listed = parseListPackage(OUTDATED);
    expect(listed?.map((p) => [p.id, p.resolved, p.latest])).toEqual([
      ['Newtonsoft.Json', '12.0.1', '13.0.4'],
      ['coverlet.collector', '6.0.4', '10.1.0'],
      ['Microsoft.NET.Test.Sdk', '17.14.1', '18.10.1'],
      ['xunit.runner.visualstudio', '3.1.4', '4.0.0'],
    ]);
    expect(JSON.stringify(listed)).not.toContain('C:/work');
  });

  it('maps advisories to severity and https URLs', () => {
    expect(parseListPackage(VULNERABLE)?.[0]?.advisories).toEqual([
      {
        id: 'GHSA-5crp-9r3c-p9vr',
        title: 'GHSA-5crp-9r3c-p9vr',
        severity: 'high',
        url: 'https://github.com/advisories/GHSA-5crp-9r3c-p9vr',
        range: null,
      },
    ]);
    const [transitive] = parseListPackage(TRANSITIVE) ?? [];
    expect(transitive).toMatchObject({ id: 'System.Text.Json', transitive: true });
    expect(transitive?.advisories.map((a) => [a.severity, a.url])).toEqual([
      ['high', 'https://github.com/advisories/GHSA-hh2w-p6rv-4g7w'],
      ['moderate', null],
    ]);
  });

  it('returns null for text that is not the JSON report', () => {
    expect(parseListPackage('error: unknown option --format')).toBeNull();
    expect(parseListPackage('{"version":1}')).toBeNull();
  });
});

describe('dotnetRows', () => {
  it('merges outdated and vulnerable packages into rows', () => {
    const rows = dotnetRows(parseListPackage(OUTDATED) ?? [], [
      ...(parseListPackage(VULNERABLE) ?? []),
      ...(parseListPackage(TRANSITIVE) ?? []),
    ]);
    expect(rows.find((r) => r.name === 'Newtonsoft.Json')).toMatchObject({
      type: 'prod',
      range: '12.0.1',
      current: '12.0.1',
      latest: '13.0.4',
      outdated: true,
      major: true,
      advisories: [{ severity: 'high' }],
    });
    expect(rows.find((r) => r.name === 'System.Text.Json')).toMatchObject({
      type: null,
      range: null,
      current: '8.0.0',
      outdated: false,
    });
    expect(rows).toHaveLength(5);
  });
});

describe('checkDotnet', () => {
  const info: DotnetInfo = {
    solution: null,
    project: 'Shop.Core.csproj',
    targetFrameworks: ['net8.0'],
    isWeb: false,
    isTest: false,
    sdk: null,
    launchProfiles: [],
  };

  it('runs both lists on the project with dotnet banners off', async () => {
    const run = vi.fn(async (_c: string, args: string[]) => ({
      code: 0,
      stdout: args.includes('--outdated') ? OUTDATED : VULNERABLE,
      timedOut: false,
    }));
    const result = await checkDotnet(info, run);
    expect(run.mock.calls).toEqual([
      [
        'dotnet',
        ['list', 'Shop.Core.csproj', 'package', '--outdated', '--format', 'json'],
        DOTNET_ENV,
      ],
      [
        'dotnet',
        [
          'list',
          'Shop.Core.csproj',
          'package',
          '--vulnerable',
          '--include-transitive',
          '--format',
          'json',
        ],
        DOTNET_ENV,
      ],
    ]);
    expect(result).toMatchObject({ manager: 'dotnet', errors: [] });
    expect(result?.rows).toHaveLength(4);
  });

  it('reports a failed or timed-out step and keeps the other', async () => {
    const run = vi.fn(async (_c: string, args: string[]) =>
      args.includes('--outdated')
        ? { code: 1, stdout: 'error: The --format option requires SDK 7.0.200', timedOut: false }
        : { code: null, stdout: '', timedOut: true },
    );
    expect(await checkDotnet(info, run)).toEqual({
      manager: 'dotnet',
      rows: [],
      errors: [
        { step: 'outdated', code: 'failed' },
        { step: 'audit', code: 'timeout' },
      ],
    });
  });

  it('skips a solution-only folder', async () => {
    const run = vi.fn();
    expect(await checkDotnet({ ...info, solution: 'Shop.sln', project: null }, run)).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('copies an update command for a NuGet id', () => {
    expect(dotnetUpdateCommand('Newtonsoft.Json')).toBe('dotnet add package Newtonsoft.Json');
  });
});
