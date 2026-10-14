import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PackageResult } from '@shared/tools/deps/contract';
import { createMemoryLogger } from '../../logger';
import { createDepsCache } from './cache';

const result = (
  projectId: string,
  relPath = '',
  ecosystem: PackageResult['ecosystem'] = 'node',
): PackageResult => ({
  projectId,
  relPath,
  name: 'demo',
  ecosystem,
  manager: ecosystem === 'dotnet' ? 'dotnet' : 'npm',
  checkedAt: 1,
  rows: [
    {
      name: 'lodash',
      type: 'prod',
      range: '4.17.15',
      current: '4.17.15',
      wanted: '4.17.15',
      latest: '4.18.1',
      outdated: true,
      major: false,
      advisories: [],
    },
  ],
  errors: [],
});

describe('deps cache', () => {
  it('survives a restart and forgets a removed project with its packages', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'nestbox-deps-cache-')), 'deps-cache.json');
    const cache = createDepsCache(file, createMemoryLogger());
    cache.set(result('r1'));
    cache.set(result('r1::packages/api', 'packages/api'));
    cache.set(result('r2'));
    const again = createDepsCache(file, createMemoryLogger());
    expect(again.forPackage('r1::packages/api').map((r) => r.relPath)).toEqual(['packages/api']);
    again.forget((id) => id === 'r1' || id.startsWith('r1::'));
    expect(
      createDepsCache(file, createMemoryLogger())
        .all()
        .map((r) => r.projectId),
    ).toEqual(['r2']);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ version: 1 });
  });

  it('keeps one result per ecosystem of a package, Node first', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'nestbox-deps-cache-')), 'deps-cache.json');
    const cache = createDepsCache(file, createMemoryLogger());
    cache.set(result('r1', '', 'dotnet'));
    cache.set(result('r1', '', 'node'));
    cache.set({ ...result('r1', '', 'node'), checkedAt: 2 });
    const again = createDepsCache(file, createMemoryLogger());
    expect(again.forPackage('r1').map((r) => [r.ecosystem, r.checkedAt])).toEqual([
      ['node', 2],
      ['dotnet', 1],
    ]);
    expect(again.forPackage('r2')).toEqual([]);
  });

  it("reads a file from before ecosystems, by each result's manager", () => {
    const file = join(mkdtempSync(join(tmpdir(), 'nestbox-deps-cache-')), 'deps-cache.json');
    const { ecosystem: _n, ...npm } = result('r1');
    const { ecosystem: _d, ...nuget } = result('r2', '', 'dotnet');
    writeFileSync(file, JSON.stringify({ version: 1, results: { r1: npm, r2: nuget } }));
    const cache = createDepsCache(file, createMemoryLogger());
    expect(cache.forPackage('r1').map((r) => r.ecosystem)).toEqual(['node']);
    expect(cache.forPackage('r2').map((r) => r.ecosystem)).toEqual(['dotnet']);
  });

  it('ignores a malformed file', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'nestbox-deps-cache-')), 'deps-cache.json');
    writeFileSync(file, '{"version":1,"results":{"r1":{"nope":true}}}');
    const logger = createMemoryLogger();
    expect(createDepsCache(file, logger).all()).toEqual([]);
    expect(logger.entries.map((e) => e.message)).toEqual(['deps cache unreadable']);
  });
});
