/** True when `url` belongs to Nestbox's own renderer. */
export function isAppUrl(url: string, devServerUrl?: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (devServerUrl) {
    try {
      return parsed.origin === new URL(devServerUrl).origin;
    } catch {
      return false;
    }
  }
  return parsed.protocol === 'file:';
}
