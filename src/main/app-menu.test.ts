import { describe, expect, it, vi } from 'vitest';
import { appMenuTemplate } from './app-menu';

function setup(isDev = false) {
  const actions = { settings: vi.fn(), quit: vi.fn() };
  const template = appMenuTemplate({ appName: 'NestBox', isDev, actions });
  const item = (menu: string, label: string) => {
    const submenu = template.find((m) => m.label === menu)?.submenu;
    return Array.isArray(submenu) ? submenu.find((i) => i.label === label || i.role === label) : undefined;
  };
  return { template, item, actions };
}

describe('appMenuTemplate (macOS)', () => {
  it('has the app, Edit, View and Window menus', () => {
    expect(setup().template.map((m) => m.label)).toEqual(['NestBox', 'Edit', 'View', 'Window']);
  });

  it('opens Settings with ⌘, and quits through the quit controller with ⌘Q', () => {
    const { item, actions } = setup();
    const settings = item('NestBox', 'Settings…');
    expect(settings?.accelerator).toBe('Cmd+,');
    (settings?.click as () => void)();
    expect(actions.settings).toHaveBeenCalled();
    const quit = item('NestBox', 'Quit NestBox');
    expect(quit?.accelerator).toBe('Cmd+Q');
    expect(quit?.role).toBeUndefined();
    (quit?.click as () => void)();
    expect(actions.quit).toHaveBeenCalled();
  });

  it('keeps the Edit roles, so copy and paste work in text fields', () => {
    const { item } = setup();
    for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) expect(item('Edit', role)).toBeDefined();
  });

  it('offers reload and DevTools only in development', () => {
    expect(setup(false).item('View', 'reload')).toBeUndefined();
    expect(setup(false).item('View', 'toggleDevTools')).toBeUndefined();
    expect(setup(true).item('View', 'reload')).toBeDefined();
    expect(setup(false).item('View', 'togglefullscreen')).toBeDefined();
  });
});
