import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseBerryAudit,
  parseBunAudit,
  parseNpmAudit,
  parseNpmOutdated,
  parsePnpmAudit,
  parsePnpmOutdated,
  parseYarn1Audit,
  parseYarn1Outdated,
} from './parse';

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

const OUTDATED = [
  { name: 'lodash', current: '4.17.15', wanted: '4.17.15', latest: '4.18.1' },
  { name: 'semver', current: '6.3.1', wanted: '6.3.1', latest: '7.8.5' },
];
const COMMAND_INJECTION = {
  id: 'GHSA-35jh-r3h4-6jhm',
  title: 'Command Injection in lodash',
  severity: 'high',
  url: 'https://github.com/advisories/GHSA-35jh-r3h4-6jhm',
  range: '<4.17.21',
};

describe('outdated parsers (real output)', () => {
  it('reads npm, pnpm and Yarn 1', () => {
    expect(parseNpmOutdated(fixture('npm-outdated.json'))).toEqual(OUTDATED);
    expect(parsePnpmOutdated(fixture('pnpm-outdated.json'))).toEqual(OUTDATED);
    expect(parseYarn1Outdated(fixture('yarn1-outdated.jsonl'))).toEqual(OUTDATED);
  });

  it('treats empty output as nothing outdated and junk as a failure', () => {
    expect(parseNpmOutdated('')).toEqual([]);
    expect(parseNpmOutdated('{}')).toEqual([]);
    expect(parsePnpmOutdated('\n')).toEqual([]);
    expect(parseYarn1Outdated('')).toEqual([]);
    expect(parseNpmOutdated('npm ERR! code ENOTFOUND')).toBeNull();
    expect(parsePnpmOutdated('[1,2]')).toBeNull();
  });

  it('takes the first entry when npm lists a package in several workspaces', () => {
    const text = JSON.stringify({
      react: [{ current: '18.2.0', wanted: '18.3.1', latest: '19.2.0' }, { current: '18.0.0' }],
    });
    expect(parseNpmOutdated(text)).toEqual([
      { name: 'react', current: '18.2.0', wanted: '18.3.1', latest: '19.2.0' },
    ]);
  });
});

describe('audit parsers (real output)', () => {
  it('reads npm: advisories from via objects, skipping dependents that only name another package', () => {
    const vulns = parseNpmAudit(fixture('npm-audit.json'));
    expect(vulns?.get('lodash')?.[0]).toEqual(COMMAND_INJECTION);
    expect(vulns?.get('lodash')).toHaveLength(2);
    const transitive = JSON.stringify({
      auditReportVersion: 2,
      vulnerabilities: {
        express: { name: 'express', severity: 'high', via: ['qs'] },
        qs: {
          name: 'qs',
          severity: 'high',
          via: [
            { source: 1, title: 'qs DoS', url: 'https://x/1', severity: 'high', range: '<6.10.3' },
          ],
        },
      },
    });
    expect([...(parseNpmAudit(transitive)?.keys() ?? [])]).toEqual(['qs']);
  });

  it('reads pnpm, Yarn 1, Yarn 2+ and Bun', () => {
    for (const vulns of [
      parsePnpmAudit(fixture('pnpm-audit.json')),
      parseYarn1Audit(fixture('yarn1-audit.jsonl')),
      parseBerryAudit(fixture('berry-audit.jsonl')),
      parseBunAudit(fixture('bun-audit.json')),
    ]) {
      expect(vulns?.get('lodash')?.[0]).toEqual(COMMAND_INJECTION);
      expect(vulns?.get('lodash')).toHaveLength(2);
    }
  });

  it('keeps https links only, maps unknown severities and dedupes advisories', () => {
    const text = JSON.stringify({
      x: [
        {
          id: 1,
          url: 'javascript:alert(1)',
          title: 'A',
          severity: 'medium',
          vulnerable_versions: '<2',
        },
        {
          id: 1,
          url: 'javascript:alert(1)',
          title: 'A',
          severity: 'medium',
          vulnerable_versions: '<2',
        },
        { id: 2, url: 'https://ok', title: 'B', severity: 'weird', vulnerable_versions: null },
      ],
    });
    expect(parseBunAudit(text)?.get('x')).toEqual([
      { id: '1', title: 'A', severity: 'moderate', url: null, range: '<2' },
      { id: '2', title: 'B', severity: 'info', url: 'https://ok', range: null },
    ]);
  });

  it('treats no findings as an empty result and junk as a failure', () => {
    expect(
      parseNpmAudit(JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} }))?.size,
    ).toBe(0);
    expect(parseBerryAudit('')?.size).toBe(0);
    expect(parseBunAudit('{}')?.size).toBe(0);
    expect(parseNpmAudit('')).toBeNull();
    expect(parsePnpmAudit('{"error":{"code":"ENOTFOUND"}}')).toBeNull();
    expect(parseBunAudit('error: connection refused')).toBeNull();
  });
});
