import { describe, expect, it, vi } from 'vitest';
import type { DetectedProject } from '@shared/detected';
import { NestboxError } from '@shared/errors';
import { AppSettingsSchema, type AppSettings } from '@shared/types';
import { SettingsPatchSchema } from '@shared/settings';
import { createCoreHandlers, type CoreHandlerDeps } from './core-handlers';

const detected = (over: Partial<DetectedProject> = {}): DetectedProject => ({
  id: 'p1', rootId: 'p1', path: 'C:\\Dev\\R&D Shop', relPath: '', name: 'shop', missing: false,
  packageJson: null, packageManager: null, envFiles: [], envSymlinks: [], workspaces: [], prismaSchema: null,
  dockerCompose: null, deploy: [], git: null, buildOutput: null,
  claude: { claudeMd: false, claudeLocalMd: false, claudeDir: false, mcpJson: false },
  ecosystems: [],
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
      list: vi.fn(), add: vi.fn(), scan: vi.fn(), addFolders: vi.fn(), remove: vi.fn(), rename: vi.fn(), setPinned: vi.fn(),
      refresh: vi.fn(async () => ({}) as never),
      getDetected: vi.fn(() => detected()),
      moveProject: vi.fn(),
      listGroups: vi.fn(() => [{ id: 'g1', name: 'Work', collapsed: false }]),
      createGroup: vi.fn((name: string) => ({ id: 'g2', name, collapsed: false })),
      renameGroup: vi.fn(),
      deleteGroup: vi.fn(),
      setGroupCollapsed: vi.fn(),
      moveGroup: vi.fn(),
    },
    toolHost: {
      list: vi.fn(async () => []),
      invoke: vi.fn(),
      disposeAll: vi.fn(),
      forgetProject: vi.fn(),
      deactivate: vi.fn(),
      busyTools: vi.fn(() => ['static']),
    },
    platform: {
      openInEditor: vi.fn(async () => {}),
      openTerminal: vi.fn(async () => {}),
      commandExists: vi.fn(async (): Promise<boolean | null> => true),
    },
    appInfo: () => ({ version: '0.0.0', platform: 'win32' }),
    pickFolder: vi.fn(async () => null),
    isDirectory: vi.fn(async () => true),
    settings: memorySettings(),
    onSettingsChanged: vi.fn(),
    processes: { list: vi.fn(() => []), stopAll: vi.fn(async () => {}), forget: vi.fn() },
    openExternal: vi.fn(async () => {}),
    ports: {
      list: vi.fn(async () => ({ rows: [], scannedAt: 1, stale: false })),
      kill: vi.fn(async () => ({ result: 'killed' as const, processName: 'node.exe' })),
      waitUntilFree: vi.fn(async () => true),
    },
    deps: {
      overview: vi.fn(async () => ({ projects: [], runningAll: false, schedule: 'off' as const })),
      checkAll: vi.fn(),
    },
    getSystemStats: vi.fn(async () => ({ cpuPercent: 10, memoryUsed: 1024 * 1024 * 1024, memoryTotal: 8 * 1024 * 1024 * 1024 })),
    getProcessStats: vi.fn(async () => ({ cpuPercent: 5, memoryUsed: 512 * 1024 * 1024 })),
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

    it('refuses an editor command that does not exist, without echoing it', async () => {
      const d = deps();
      vi.mocked(d.platform.commandExists).mockResolvedValueOnce(false);
      const error = await createCoreHandlers(d)['settings:update']({ editorCommand: 'nonexistent-editor' }).catch((e) => e);
      expect(error).toMatchObject({ code: 'NOT_FOUND', message: 'That editor command was not found on PATH' });
      expect(String(error.message)).not.toContain('nonexistent-editor');
      expect(d.settings.getSettings().editorCommand).toBe('code');
    });

    it('accepts an editor it cannot check, and skips the check when the editor is unchanged', async () => {
      const d = deps();
      vi.mocked(d.platform.commandExists).mockResolvedValueOnce(null);
      await createCoreHandlers(d)['settings:update']({ editorCommand: 'cursor' });
      expect(d.settings.getSettings().editorCommand).toBe('cursor');
      await createCoreHandlers(d)['settings:update']({ editorCommand: 'cursor', closeToTray: false });
      expect(d.platform.commandExists).toHaveBeenCalledTimes(1);
    });

    it('rejects on a read-only store without notifying', async () => {
      const d = deps({ settings: memorySettings(true) });
      await expect(createCoreHandlers(d)['settings:update']({ closeToTray: false })).rejects.toMatchObject({
        code: 'INTERNAL',
      });
      expect(d.onSettingsChanged).not.toHaveBeenCalled();
    });
  });

  describe('processes', () => {
    it('lists processes from the manager', async () => {
      const d = deps();
      const summary = {
        projectId: 'p1', script: 'dev', state: 'running' as const, pid: 1, startedAt: 1, exit: null,
        crashCount: 0, autoRestart: false, nextRestartAt: null, gaveUp: false, warning: null,
      };
      vi.mocked(d.processes.list).mockReturnValue([summary]);
      expect(await createCoreHandlers(d)['processes:list']()).toEqual([summary]);
    });

    it('stops everything, or one project with its workspaces', async () => {
      const d = deps();
      const handlers = createCoreHandlers(d);
      await handlers['processes:stopAll']({});
      expect(d.processes.stopAll).toHaveBeenLastCalledWith(undefined);
      await handlers['processes:stopAll']({ projectId: 'r1' });
      const filter = vi.mocked(d.processes.stopAll).mock.calls.at(-1)?.[0];
      expect(['r1', 'r1::a', 'r10', 'r2'].map((id) => filter?.(id))).toEqual([true, true, false, false]);
    });

    it('refuses to remove a workspace package without stopping anything', async () => {
      const d = deps();
      await expect(createCoreHandlers(d)['projects:remove']({ id: 'r1::packages/api' })).rejects.toMatchObject({
        code: 'VALIDATION',
      });
      expect(d.processes.stopAll).not.toHaveBeenCalled();
    });

    it('removes a stored project even when its detection is not available', async () => {
      const d = deps();
      vi.mocked(d.projects.getDetected).mockImplementation(() => {
        throw new NestboxError('NOT_FOUND', 'Project not found');
      });
      await createCoreHandlers(d)['projects:remove']({ id: 'r1' });
      expect(d.projects.remove).toHaveBeenCalledWith('r1');
    });

    it('stops and forgets a project\'s processes before removing it', async () => {
      const order: string[] = [];
      const d = deps();
      vi.mocked(d.processes.stopAll).mockImplementation(async () => void order.push('stopAll'));
      vi.mocked(d.processes.forget).mockImplementation(() => void order.push('forget'));
      vi.mocked(d.projects.remove).mockImplementation(() => void order.push('remove'));
      vi.mocked(d.toolHost.forgetProject).mockImplementation(() => void order.push('tools'));
      await createCoreHandlers(d)['projects:remove']({ id: 'r1' });
      expect(order).toEqual(['stopAll', 'forget', 'remove', 'tools']);
      expect(d.toolHost.forgetProject).toHaveBeenCalledWith('r1');
      const filter = vi.mocked(d.processes.stopAll).mock.calls[0]?.[0];
      expect(filter?.('r1::packages/api')).toBe(true);
      expect(filter?.('r2')).toBe(false);
    });
  });

  describe('ports', () => {
    it('lists, kills and waits through the port service', async () => {
      const d = deps();
      const handlers = createCoreHandlers(d);
      expect(await handlers['ports:list']()).toEqual({ rows: [], scannedAt: 1, stale: false });
      expect(await handlers['ports:kill']({ pid: 77, port: 5432, confirmed: true })).toEqual({ result: 'killed', processName: 'node.exe' });
      expect(d.ports.kill).toHaveBeenCalledWith({ pid: 77, port: 5432, confirmed: true });
      expect(await handlers['ports:waitFree']({ port: 3000, timeoutMs: 5_000 })).toBe(true);
      expect(d.ports.waitUntilFree).toHaveBeenCalledWith(3000, 5_000);
    });
  });

  describe('app:openExternal', () => {
    it('opens http and https links', async () => {
      const d = deps();
      await createCoreHandlers(d)['app:openExternal']({ url: 'https://example.com/docs?x=1' });
      expect(d.openExternal).toHaveBeenCalledWith('https://example.com/docs?x=1');
    });

    it.each(['file:///C:/Windows/system32/calc.exe', 'javascript:alert(1)', 'ms-settings:', 'not a url', 'http//x'])(
      'refuses %j',
      async (url) => {
        const d = deps();
        await expect(createCoreHandlers(d)['app:openExternal']({ url })).rejects.toMatchObject({ code: 'VALIDATION' });
        expect(d.openExternal).not.toHaveBeenCalled();
      },
    );
  });

  it('answers the Dependencies page from the cache and starts Check all in the background', async () => {
    const d = deps();
    const handlers = createCoreHandlers(d);
    expect(await handlers['deps:overview']()).toEqual({ projects: [], runningAll: false, schedule: 'off' });
    await handlers['deps:checkAll']();
    expect(d.deps.checkAll).toHaveBeenCalledTimes(1);
  });
});

describe('tools:busy and turning tools off', () => {
  it('answers the busy tool ids', async () => {
    const handlers = createCoreHandlers(deps());
    expect(await handlers['tools:busy']()).toEqual(['static']);
  });

  it('accepts only toggleable tools and toolsChosen: true in a settings patch', async () => {
    const d = deps();
    const handlers = createCoreHandlers(d);
    const view = await handlers['settings:update']({ disabledTools: ['static', 'git'], toolsChosen: true });
    expect(view).toMatchObject({ disabledTools: ['static', 'git'], toolsChosen: true });
    expect(SettingsPatchSchema.safeParse({ disabledTools: ['scripts'] }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ disabledTools: ['nope'] }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ toolsChosen: false }).success).toBe(false);
  });
});

describe('groups and project order', () => {
  it('passes moves and group changes to the project service', async () => {
    const d = deps();
    const handlers = createCoreHandlers(d);
    await handlers['projects:move']({ id: 'p1', groupId: 'g1', beforeId: null });
    expect(d.projects.moveProject).toHaveBeenCalledWith('p1', 'g1', null);
    expect(await handlers['groups:list']()).toEqual([{ id: 'g1', name: 'Work', collapsed: false }]);
    expect(await handlers['groups:create']({ name: 'Side' })).toMatchObject({ name: 'Side' });
    await handlers['groups:move']({ id: 'g2', beforeId: 'g1' });
    expect(d.projects.moveGroup).toHaveBeenCalledWith('g2', 'g1');
  });
});
