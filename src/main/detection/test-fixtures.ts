import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Creates a temp folder tree. Keys are posix-style relative paths; null creates a directory. */
export async function makeTree(entries: Record<string, string | null>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'nestbox-detect-'));
  for (const [rel, content] of Object.entries(entries)) {
    const target = join(root, ...rel.split('/'));
    if (content === null) {
      await mkdir(target, { recursive: true });
    } else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');
    }
  }
  return root;
}

export async function removeTree(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
