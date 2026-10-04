import type { DepRow, PackageResult } from '@shared/tools/deps/contract';

export const row = (over: Partial<DepRow> = {}): DepRow => ({
  name: 'ms',
  type: 'prod',
  range: '^2.0.0',
  current: '2.1.3',
  wanted: null,
  latest: null,
  outdated: false,
  major: false,
  advisories: [],
  ...over,
});

export const LODASH = row({
  name: 'lodash',
  range: '4.17.15',
  current: '4.17.15',
  wanted: '4.17.15',
  latest: '4.18.1',
  outdated: true,
  advisories: [
    {
      id: 'GHSA-35jh-r3h4-6jhm',
      title: 'Command Injection in lodash',
      severity: 'high',
      url: 'https://github.com/advisories/GHSA-35jh-r3h4-6jhm',
      range: '<4.17.21',
    },
  ],
});
export const SEMVER = row({
  name: 'semver',
  type: 'dev',
  range: '~6.3.0',
  current: '6.3.1',
  wanted: '6.3.1',
  latest: '7.8.5',
  outdated: true,
  major: true,
});

export const result = (over: Partial<PackageResult> = {}): PackageResult => ({
  projectId: 'p1',
  relPath: '',
  name: 'shop',
  manager: 'npm',
  checkedAt: Date.now() - 2 * 3_600_000,
  rows: [row(), SEMVER, LODASH],
  errors: [],
  ...over,
});
