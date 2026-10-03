import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchDir } from './watch-dir';

let dir = '';
afterEach(async () => rm(dir, { recursive: true, force: true }));

describe('watchDir', () => {
  it('returns null for a folder that does not exist', () => {
    expect(watchDir(join(tmpdir(), 'nestbox-missing-folder-x9'), false, () => undefined)).toBeNull();
  });

  it('reports changes in subfolders when recursive', async () => {
    dir = await mkdtemp(join(tmpdir(), 'nestbox-watch-'));
    await mkdir(join(dir, 'heads'));
    const onChange = vi.fn();
    const stop = watchDir(dir, true, onChange);
    expect(stop).not.toBeNull();
    await writeFile(join(dir, 'heads', 'main'), 'x');
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 3_000 });
    stop?.();
  });
});
