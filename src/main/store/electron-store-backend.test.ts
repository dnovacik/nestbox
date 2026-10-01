import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_SCHEMA_VERSION, defaultStoreData } from '@shared/types';

// electron-store only touches app.getPath/getVersion and ipcMain.on at construction time.
vi.mock('electron', () => {
  const app = { getPath: () => '', getName: () => 'nestbox', getVersion: () => '0.0.0' };
  const ipcMain = { on: vi.fn(), handle: vi.fn() };
  return { default: { app, ipcMain, shell: {} }, app, ipcMain };
});

import { createElectronStoreBackend } from './electron-store-backend';

describe('electron-store backend corruption chain', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nestbox-store-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('detects malformed JSON, moves the file aside and writes fresh defaults', () => {
    const file = join(dir, 'config.json');
    writeFileSync(file, '{oops');
    const backend = createElectronStoreBackend(dir);

    expect(() => backend.read()).toThrow(SyntaxError);

    const backup = backend.backupCorrupt();
    expect(backup).toMatch(/config\.corrupt-\d+\.json$/);
    expect(existsSync(backup ?? '')).toBe(true);
    expect(existsSync(file)).toBe(false);

    backend.write(defaultStoreData());
    const written = JSON.parse(readFileSync(file, 'utf8')) as { schemaVersion: number };
    expect(written.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });
});
