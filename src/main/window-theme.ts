/** Window chrome colours (main process only; renderer uses CSS tokens). Values from docs/design/DESIGN-NOTES.md. */
export const WINDOW_COLORS = {
  background: '#0D1117',
  titleBar: '#161B22',
  titleBarSymbols: '#C9D1D9',
} as const;

export const TITLE_BAR_HEIGHT = 40;

/**
 * Height of the native window-control overlay (Windows). One pixel short of the title bar, so the title
 * bar's bottom border also runs under the minimise, maximise and close buttons.
 */
export const TITLE_BAR_OVERLAY_HEIGHT = TITLE_BAR_HEIGHT - 1;
