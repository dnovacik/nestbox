/** Window chrome colours (main process only; renderer uses CSS tokens). Dark values from docs/design/DESIGN-NOTES.md. */
export const WINDOW_COLORS = {
  background: '#0D1117',
  titleBar: '#161B22',
  titleBarSymbols: '#C9D1D9',
} as const;

/** The light theme's equivalents (bg, card and text tokens in globals.css). */
export const WINDOW_COLORS_LIGHT = {
  background: '#FFFFFF',
  titleBar: '#F6F8FA',
  titleBarSymbols: '#1F2328',
} as const;

export type WindowColors = { background: string; titleBar: string; titleBarSymbols: string };

export function windowColors(dark: boolean): WindowColors {
  return dark ? WINDOW_COLORS : WINDOW_COLORS_LIGHT;
}

/**
 * Recolours an open window when the theme changes: its background (seen while resizing) and, on Windows,
 * the native title-bar overlay behind the minimise, maximise and close buttons.
 */
export function applyWindowTheme(
  win: { setBackgroundColor(color: string): void; setTitleBarOverlay?(o: { color: string; symbolColor: string }): void },
  chrome: { hasOverlay: boolean },
  dark: boolean,
): void {
  const colors = windowColors(dark);
  win.setBackgroundColor(colors.background);
  if (chrome.hasOverlay) win.setTitleBarOverlay?.({ color: colors.titleBar, symbolColor: colors.titleBarSymbols });
}

export const TITLE_BAR_HEIGHT = 40;

/**
 * Height of the native window-control overlay (Windows). One pixel short of the title bar, so the title
 * bar's bottom border also runs under the minimise, maximise and close buttons.
 */
export const TITLE_BAR_OVERLAY_HEIGHT = TITLE_BAR_HEIGHT - 1;
