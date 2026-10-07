import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectProject } from './detect-project';
import { ECOSYSTEM_MODULES } from '../ecosystems';
import { TEST_ECOSYSTEM_MODULE } from '../ecosystems/test-module';
import type { EcosystemModule } from '../ecosystems/types';

describe('detectProject with ecosystems', () => {
  let testDir: string;
  let originalModules: EcosystemModule<unknown, unknown>[];

  beforeEach(async () => {
    testDir = join(tmpdir(), `nestbox-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });

    // Temporarily inject test module
    originalModules = [...ECOSYSTEM_MODULES];
    (ECOSYSTEM_MODULES as EcosystemModule<unknown, unknown>[]).length = 0;
    (ECOSYSTEM_MODULES as EcosystemModule<unknown, unknown>[]).push(TEST_ECOSYSTEM_MODULE);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });

    // Restore original modules
    (ECOSYSTEM_MODULES as EcosystemModule<unknown, unknown>[]).length = 0;
    (ECOSYSTEM_MODULES as EcosystemModule<unknown, unknown>[]).push(...originalModules);
  });

  it('detects ecosystem when marker file exists', async () => {
    await writeFile(join(testDir, 'test-marker.txt'), '');
    await writeFile(join(testDir, 'README.md'), '# Test');

    const result = await detectProject({ id: 'test', path: testDir });

    expect(result.ecosystems).toHaveLength(1);
    expect(result.ecosystems[0]).toEqual({
      id: 'python',
      info: {
        version: '1.0.0',
        marker: 'test-marker.txt',
      },
    });
  });

  it('has empty ecosystems when no module detects', async () => {
    await writeFile(join(testDir, 'README.md'), '# Test');

    const result = await detectProject({ id: 'test', path: testDir });

    expect(result.ecosystems).toEqual([]);
  });

  it('validates info with module schema', async () => {
    await writeFile(join(testDir, 'test-marker.txt'), '');

    const result = await detectProject({ id: 'test', path: testDir });

    // The info should be validated and present
    expect(result.ecosystems[0]?.info).toMatchObject({
      version: expect.any(String),
      marker: expect.any(String),
    });
  });

  it('includes ecosystems in missing projects', async () => {
    const result = await detectProject({ id: 'test', path: join(testDir, 'nonexistent') });

    expect(result.missing).toBe(true);
    expect(result.ecosystems).toEqual([]);
  });
});
