import { watch } from 'node:fs';

/**
 * fs.watch that never keeps the app alive and never throws: a folder that can't be watched (missing,
 * no permission, too many watches) returns null, and a watcher that errors later closes itself.
 */
export function watchDir(dir: string, recursive: boolean, onChange: (fileName: string | null) => void): (() => void) | null {
  try {
    const watcher = watch(dir, { persistent: false, recursive }, (_event, name) => onChange(name === null ? null : String(name)));
    watcher.on('error', () => watcher.close());
    return () => watcher.close();
  } catch {
    return null;
  }
}
