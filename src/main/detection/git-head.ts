import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { GitInfo } from '@shared/detected';
import { statOrNull } from './fs-utils';

const UNKNOWN: GitInfo = { branch: null, head: null };

export async function readGitInfo(dir: string): Promise<GitInfo | null> {
  const dotGit = join(dir, '.git');
  const st = await statOrNull(dotGit);
  if (!st) return null;

  let gitDir = dotGit;
  if (st.isFile()) {
    const pointer = await readFile(dotGit, 'utf8').catch(() => '');
    const target = /^gitdir:\s*(.+)$/m.exec(pointer)?.[1]?.trim();
    if (!target) return UNKNOWN;
    gitDir = resolve(dir, target);
  }

  const head = (await readFile(join(gitDir, 'HEAD'), 'utf8').catch(() => null))?.trim();
  if (!head) return UNKNOWN;

  const branch = /^ref:\s*refs\/heads\/(.+)$/.exec(head)?.[1];
  if (branch) return { branch, head: null };
  if (/^[0-9a-f]{40,64}$/i.test(head)) return { branch: null, head: head.slice(0, 7) };
  return UNKNOWN;
}
