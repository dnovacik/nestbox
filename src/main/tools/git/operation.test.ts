import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectOperation } from './operation';

const existsOnly =
  (...names: string[]) =>
  async (path: string) =>
    names.some((n) => path === join('/g', n));

describe('detectOperation', () => {
  it('is null when nothing is in progress', async () => {
    expect(await detectOperation('/g', existsOnly())).toBeNull();
  });

  it.each([
    ['MERGE_HEAD', 'merge'],
    ['rebase-merge', 'rebase'],
    ['rebase-apply', 'rebase'],
    ['CHERRY_PICK_HEAD', 'cherry-pick'],
    ['REVERT_HEAD', 'revert'],
    ['BISECT_LOG', 'bisect'],
  ])('%s means %s', async (name, op) => {
    expect(await detectOperation('/g', existsOnly(name))).toBe(op);
  });

  it('prefers a rebase over the merge it is replaying', async () => {
    expect(await detectOperation('/g', existsOnly('MERGE_HEAD', 'rebase-merge'))).toBe('rebase');
  });
});
