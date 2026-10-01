import { describe, expect, it, vi } from 'vitest';
import type { DetectedProject } from '@shared/detected';
import { NestboxError } from '@shared/errors';
import { AppSettingsSchema, type AppSettings } from '@shared/types';
import { createCoreHandlers, type CoreHandlerDeps } from './core-handlers';

const detected = (over: Partial<DetectedProject> = {}): DetectedProject => ({
  id: 'p1', rootId: 'p1', path: 'C:\\Dev\\R&D Shop', relPath: '', name: 'shop', missing: false,
  packageJson: null, packageManager: null, envFiles: [], workspaces: [], prismaSchema: null,
  dockerCompose: null, git: null, buildOutput: null,
  claude: { claudeMd: false, claudeLocalMd: false, claudeDir: false, mcpJson: false },
  ...over,
});

function memorySettings(readOnly = false) {
  let current: AppSettings = AppSettingsSchema.parse({});
  return {
    getSettings: () => current,
    isReadOnly: () => readOnly,
    updateSettings: vi.fn((fn: (s: AppSettings) => AppSettings) => {
      if (readOnly) throw new NestboxError('INTERNAL', 'Settings are read-only; changes cannot be saved');
      current = AppSettingsSchema.parse(fn(current));
    }),
  };
}

function deps(over: Partial<CoreHandlerDeps> = {}): CoreHandlerDeps {
  return {
    projects: {
      list: vi.fn(), add: vi.fn(), remove: vi.fn(), rename: vi.fn(), setPinned: vi.fn(),
      refresh: vi.fn(async () => ({}) as never),
      getDetected: vi.fn(() => detected()),
    },
    toolHost: { list: vi.fn(() => []), invoke: vi.fn(), disposeAll: vi.fn() },
    platform: { openInEditor: vi.fn(async () => {}), openTerminal: vi.fn(async () => {}) },
    appInfo: () => ({ version: '0.0.0', platform: 'win32' }),
    pickFolder: vi.fn(async () => null),
    isDirectory: vi.fn(async () => true),
    settings: memorySettings(),
    onSettingsChanged: vi.fn(),
    ...over,
  };
}

describe('core handlers', () => {
  it('opens the editor with the stored path, unchanged', async () => {
    const d = deps();
    await createCoreHandlers(d)['projects:openInEditor']({ id: 'p1' });
    expect(d.platform.openInEditor).toHaveBeenCalledWith('C:\\Dev\\R&D Shop');
  });

  it('opens a terminal for a workspace package path', async () => {
    const d = deps();
    vi.mocked(d.projects.getDetected).mockReturnValue(detected({ id: 'p1::packages/api', path: 'C:\\Dev\\Shop\\packages\\api' }));
    await createCoreHandlers(d)['projects:openTerminal']({ id: 'p1::packages/api' });
    expect(d.platform.openTerminal).toHaveBeenCalledWith('C:\\Dev\\Shop\\packages\\api');
  });

  it('refuses and re-detects when the folder vanished since detection', async () => {
    const d = deps({ isDirectory: vi.fn(async () => false) });
    const handlers = createCoreHandlers(d);
    await expect(handlers['projects:openInEditor']({ id: 'p1' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'The project folder no longer exists',
    });
    expect(d.projects.refresh).toHaveBeenCalledWith('p1');
    expect(d.platform.openInEditor).not.toHaveBeenCalled();
  });

  it('refuses when detection already marked the project missing', async () => {
    const d = deps();
    vi.mocked(d.projects.getDetected).mockReturnValue(detected({ missing: true }));
    await expect(createCoreHandlers(d)['projects:openTerminal']({ id: 'p1' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'The project folder no longer exists',
    });
    expect(d.projects.refresh).toHaveBeenCalledWith('p1');
    expect(d.platform.openTerminal).not.toHaveBeenCalled();
  });

  it('delegates tools:invoke to the tool host', async () => {
    const d = deps();
    await createCoreHandlers(d)['tools:invoke']({ toolId: 't', projectId: 'p1', method: 'm', input: {} });
    expect(d.toolHost.invoke).toHaveBeenCalledWith('t', 'p1', 'm', {});
  });

  describe('settings', () => {
    it('returns the settings with the read-only flag', async () => {
      expect(await createCoreHandlers(deps())['settings:get']()).toMatchObject({ closeToTray: true, readOnly: false });
    });

    it('merges a patch, persists it and notifies once', async () => {
      const d = deps();
      const view = await createCoreHandlers(d)['settings:update']({ closeToTray: false });
      expect(view).toMatchObject({ closeToTray: false, editorCommand: 'code', readOnly: false });
      expect(d.settings.getSettings().closeToTray).toBe(false);
      expect(d.onSettingsChanged).toHaveBeenCalledTimes(1);
      expect(d.onSettingsChanged).toHaveBeenCalledWith(expect.objectContaining({ closeToTray: false }));
    });

    it('rejects on a read-only store without notifying', async () => {
      const d = deps({ settings: memorySettings(true) });
      await expect(createCoreHandlers(d)['settings:update']({ closeToTray: false })).rejects.toMatchObject({
        code: 'INTERNAL',
      });
      expect(d.onSettingsChanged).not.toHaveBeenCalled();
    });
  });
});
