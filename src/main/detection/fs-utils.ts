import { stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';

export async function statOrNull(p: string): Promise<Stats | null> {
  try {
    return await stat(p);
  } catch {
    return null;
  }
}

export async function isDirectory(p: string): Promise<boolean> {
  return (await statOrNull(p))?.isDirectory() ?? false;
}

export async function isFile(p: string): Promise<boolean> {
  return (await statOrNull(p))?.isFile() ?? false;
}
