import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { GitInfo } from '@shared/detected';
import { statOrNull } from './fs-utils';

const UNKNOWN: GitInfo = { branch: null, head: null };

export interface GitDirs {
  /** This checkout's own git folder: HEAD, index, MERGE_HEAD. */
  gitDir: string;
  /** Shared with the main checkout for a linked worktree: refs, packed-refs, FETCH_HEAD. */
  commonDir: string;
}

/** 'none': no .git at all; 'broken': a .git file without a usable gitdir pointer. */
async function findGitDir(dir: string): Promise<string | 'none' | 'broken'> {
  const dotGit = join(dir, '.git');
  const st = await statOrNull(dotGit);
  if (!st) return 'none';
  if (!st.isFile()) return dotGit;
  const pointer = await readFile(dotGit, 'utf8').catch(() => '');
  const target = /^gitdir:\s*(.+)$/m.exec(pointer)?.[1]?.trim();
  return target ? resolve(dir, target) : 'broken';
}

/** The git folders of the repository whose .git sits in dir; null when there is none or it is unreadable. */
export async function resolveGitDirs(dir: string): Promise<GitDirs | null> {
  const gitDir = await findGitDir(dir);
  if (gitDir === 'none' || gitDir === 'broken') return null;
  const common = (await readFile(join(gitDir, 'commondir'), 'utf8').catch(() => null))?.trim();
  return { gitDir, commonDir: common ? resolve(gitDir, common) : gitDir };
}

export async function readGitInfo(dir: string): Promise<GitInfo | null> {
  const gitDir = await findGitDir(dir);
  if (gitDir === 'none') return null;
  if (gitDir === 'broken') return UNKNOWN;

  const head = (await readFile(join(gitDir, 'HEAD'), 'utf8').catch(() => null))?.trim();
  if (!head) return UNKNOWN;

  const branch = /^ref:\s*refs\/heads\/(.+)$/.exec(head)?.[1];
  if (branch) return { branch, head: null };
  if (/^[0-9a-f]{40,64}$/i.test(head)) return { branch: null, head: head.slice(0, 7) };
  return UNKNOWN;
}
