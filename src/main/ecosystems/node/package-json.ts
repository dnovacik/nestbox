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

/** Why a package.json couldn't be used: names only, never its contents. */
export type PackageJsonProblem = 'unreadable' | 'invalid-json' | 'not-an-object';

/** package.json as an object, or why it can't be used (missing or over 1 MiB counts as unreadable). */
export async function readPackageJsonChecked(
  dir: string,
): Promise<{ json: Record<string, unknown> } | { problem: PackageJsonProblem }> {
  const text = await readSmall(join(dir, 'package.json'), PACKAGE_JSON_MAX_BYTES);
  if (!text) return text === '' ? { problem: 'invalid-json' } : { problem: 'unreadable' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return { problem: 'invalid-json' };
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? { json: parsed as Record<string, unknown> }
    : { problem: 'not-an-object' };
}

/** package.json as an object; null when missing, too big, unreadable or not a JSON object. */
export async function readPackageJson(dir: string): Promise<Record<string, unknown> | null> {
  const read = await readPackageJsonChecked(dir);
  return 'json' in read ? read.json : null;
}
