import { describe, expect, it, vi } from 'vitest';
import { applyWindowTheme, windowColors } from './window-theme';

describe('window theme', () => {
  it('has a dark and a light set', () => {
    expect(windowColors(true)).toEqual({
      background: '#0D1117',
      titleBar: '#161B22',
      titleBarSymbols: '#C9D1D9',
    });
    expect(windowColors(false)).toEqual({
      background: '#FFFFFF',
      titleBar: '#F6F8FA',
      titleBarSymbols: '#1F2328',
    });
  });

  it('recolours the window, and the Windows title-bar overlay only where there is one', () => {
    const win = { setBackgroundColor: vi.fn(), setTitleBarOverlay: vi.fn() };
    applyWindowTheme(win, { hasOverlay: true }, false);
    expect(win.setBackgroundColor).toHaveBeenCalledWith('#FFFFFF');
    expect(win.setTitleBarOverlay).toHaveBeenCalledWith({
      color: '#F6F8FA',
      symbolColor: '#1F2328',
    });
    const mac = { setBackgroundColor: vi.fn(), setTitleBarOverlay: vi.fn() };
    applyWindowTheme(mac, { hasOverlay: false }, true);
    expect(mac.setBackgroundColor).toHaveBeenCalledWith('#0D1117');
    expect(mac.setTitleBarOverlay).not.toHaveBeenCalled();
  });
});
