import { join } from 'node:path';
import type { GitStatus } from '@shared/tools/git/contract';

type Operation = Extract<GitStatus, { state: 'ok' }>['operation'];

/** Marker files in the gitdir, in precedence order: a rebase can be replaying a merge or a pick. */
const MARKERS: [string, NonNullable<Operation>][] = [
  ['rebase-merge', 'rebase'],
  ['rebase-apply', 'rebase'],
  ['MERGE_HEAD', 'merge'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert'],
  ['BISECT_LOG', 'bisect'],
];

/** The merge, rebase, cherry-pick, revert or bisect in progress, from marker files (stat only). */
export async function detectOperation(gitDir: string, exists: (path: string) => Promise<boolean>): Promise<Operation> {
  const found = await Promise.all(MARKERS.map(([name]) => exists(join(gitDir, name))));
  const at = found.indexOf(true);
  return at === -1 ? null : (MARKERS[at]?.[1] ?? null);
}
