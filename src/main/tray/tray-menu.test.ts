import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { ProcessSummary } from '@shared/processes';
import { makeDetectedForTest } from '@shared/test-fixtures';
import type { ProjectSummary } from '@shared/detected';
import {
  buildTrayMenu,
  buildTrayModel,
  resolveTrayTheme,
  type TrayActions,
  trayIconPaths,
  trayState,
  trayTooltip,
} from './tray-menu';

const proc = (over: Partial<ProcessSummary>): ProcessSummary => ({
  projectId: 'p1', script: 'dev', state: 'running', pid: 1, startedAt: 1, exit: null,
  crashCount: 0, autoRestart: false, nextRestartAt: null, gaveUp: false, warning: null, ...over,
});

const ws = makeDetectedForTest({ id: 'p1::packages/api', rootId: 'p1', relPath: 'packages/api', name: 'api' });
const shop: ProjectSummary = {
  id: 'p1', name: 'shop', path: 'C:\\shop', pinned: false, tags: [], groupId: null,
  detected: makeDetectedForTest({ workspaces: [ws] }),
};
const blog: ProjectSummary = {
  id: 'p2', name: 'blog', path: 'C:\\blog', pinned: false, tags: [], groupId: null,
  detected: makeDetectedForTest({ id: 'p2', rootId: 'p2' }),
};

function actions(): TrayActions & Record<string, ReturnType<typeof vi.fn>> {
  return {
    show: vi.fn(), quit: vi.fn(), stop: vi.fn(), restart: vi.fn(), showLogs: vi.fn(),
    startRunGroup: vi.fn(), openInEditor: vi.fn(),
  };
}

const sub = (item: MenuItemConstructorOptions | undefined): MenuItemConstructorOptions[] =>
  (item?.submenu as MenuItemConstructorOptions[] | undefined) ?? [];
const click = (item: MenuItemConstructorOptions | undefined) =>
  (item?.click as (() => void) | undefined)?.();

describe('buildTrayModel', () => {
  it('collects live and crashed processes per root, labelling workspace ones', () => {
    const model = buildTrayModel(
      [shop, blog],
      [
        proc({ projectId: 'p1', script: 'web' }),
        proc({ projectId: 'p1::packages/api', script: 'dev', state: 'crashed' }),
        proc({ projectId: 'p1', script: 'build', state: 'exited' }),
        proc({ projectId: 'p2', script: 'x', state: 'stopped' }),
      ],
      (id) => (id === 'p1' ? [{ name: 'dev', entries: [], compose: [] }] : []),
    );
    expect(model.projects).toEqual([
      {
        id: 'p1', name: 'shop', runGroups: ['dev'],
        processes: [
          { projectId: 'p1', script: 'web', label: 'web', state: 'running' },
          { projectId: 'p1::packages/api', script: 'dev', label: 'api · dev', state: 'crashed' },
        ],
      },
      { id: 'p2', name: 'blog', runGroups: [], processes: [] },
    ]);
  });
});

describe('buildTrayMenu', () => {
  const model = buildTrayModel([shop, blog], [proc({ script: 'web' })], (id) => (id === 'p1' ? [{ name: 'dev', entries: [], compose: [] }] : []));

  it('lists processes with stop, restart and show logs', () => {
    const a = actions();
    const menu = buildTrayMenu(model, a);
    expect(menu[0]?.label).toBe('shop');
    const web = sub(menu[0])[0];
    expect(web?.label).toBe('web — running');
    sub(web).forEach(click);
    expect(a.stop).toHaveBeenCalledWith('p1', 'web');
    expect(a.restart).toHaveBeenCalledWith('p1', 'web');
    expect(a.showLogs).toHaveBeenCalledWith('p1', 'web');
  });

  it('offers run groups, editors, show and quit', () => {
    const a = actions();
    const menu = buildTrayMenu(model, a);
    const labels = menu.map((m) => m.label ?? m.type);
    expect(labels).toEqual(['shop', 'separator', 'Run groups', 'Open in VS Code', 'separator', 'Show NestBox', 'Quit NestBox']);
    click(sub(menu[2])[0]);
    expect(a.startRunGroup).toHaveBeenCalledWith('p1', 'dev');
    expect(sub(menu[3]).map((m) => m.label)).toEqual(['shop', 'blog']);
    click(sub(menu[3])[1]);
    expect(a.openInEditor).toHaveBeenCalledWith('p2');
    click(menu[5]);
    click(menu[6]);
    expect(a.show).toHaveBeenCalled();
    expect(a.quit).toHaveBeenCalled();
  });

  it('says when nothing runs and disables empty submenus', () => {
    const menu = buildTrayMenu({ projects: [] }, actions());
    expect(menu[0]).toEqual({ label: 'No scripts running', enabled: false });
    expect(menu[2]).toEqual({ label: 'Run groups', enabled: false });
    expect(menu[3]).toEqual({ label: 'Open in VS Code', enabled: false });
  });
});

describe('tray helpers', () => {
  it('builds the tooltip', () => {
    expect(trayTooltip([])).toBe('NestBox');
    expect(trayTooltip([proc({}), proc({ state: 'starting' })])).toBe('NestBox: 2 running');
    expect(trayTooltip([proc({ state: 'crashed' }), proc({}), proc({})])).toBe('NestBox: 1 crashed, 2 running');
  });

  it('resolves the icon theme', () => {
    expect(resolveTrayTheme('auto', true)).toBe('dark-taskbar');
    expect(resolveTrayTheme('auto', false)).toBe('light-taskbar');
    expect(resolveTrayTheme('light-taskbar', true)).toBe('light-taskbar');
  });

  it('picks the icon files and the worst state', () => {
    expect(trayIconPaths('dark-taskbar', 'crashed')).toEqual({
      x1: 'png/tray/tray-dark-taskbar-crashed-16.png',
      x2: 'png/tray/tray-dark-taskbar-crashed-32.png',
    });
    expect(trayState([proc({}), proc({ state: 'crashed' })])).toBe('crashed');
    expect(trayState([])).toBe('idle');
  });
});
