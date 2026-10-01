export interface AppOrigin {
  /** Dev only: the Vite dev server URL. Takes precedence over entryFileUrl. */
  devServerUrl?: string | undefined;
  /** Packaged: the file: URL of the renderer entry (index.html). */
  entryFileUrl?: string | undefined;
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** True when `url` is Nestbox's own renderer: the dev server origin, or exactly the entry file when packaged. */
export function isAppUrl(url: string, app: AppOrigin): boolean {
  const parsed = parse(url);
  if (!parsed) return false;
  if (app.devServerUrl) {
    const dev = parse(app.devServerUrl);
    return dev !== null && parsed.origin === dev.origin;
  }
  if (app.entryFileUrl) {
    const entry = parse(app.entryFileUrl);
    if (!entry) return false;
    // Lower-cased unconditionally: the entry path is ours, and Windows paths are case-insensitive.
    return (
      parsed.protocol === 'file:' &&
      entry.protocol === 'file:' &&
      parsed.host === '' &&
      entry.host === '' &&
      parsed.pathname.toLowerCase() === entry.pathname.toLowerCase()
    );
  }
  return false;
}
