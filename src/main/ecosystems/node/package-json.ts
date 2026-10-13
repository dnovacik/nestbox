// Reading a folder's package.json for the Node module: one capped read, parsed once. Callers pick the
// fields they need (version sources, the packageManager field); values never leave main.
import { open } from 'node:fs/promises';
import { join } from 'node:path';

const PACKAGE_JSON_MAX_BYTES = 1024 * 1024;

/** A small text file's contents; null when it is too big or unreadable; undefined when it isn't there. */
export async function readSmall(path: string, max: number): Promise<string | null | undefined> {
  let handle;
  try {
    handle = await open(path, 'r');
  } catch {
    return undefined;
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) return undefined;
    if (stats.size > max) return null;
    return await handle.readFile('utf8');
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

/** package.json as an object; null when missing, too big, unreadable or not a JSON object. */
export async function readPackageJson(dir: string): Promise<Record<string, unknown> | null> {
  const text = await readSmall(join(dir, 'package.json'), PACKAGE_JSON_MAX_BYTES);
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
