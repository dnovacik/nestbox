import { describe, expect, it, vi } from 'vitest';
import { renameWithRetry } from './versioned-file';

const fail = (code: string) => Object.assign(new Error(code), { code });

describe('renameWithRetry', () => {
  it('retries while Windows reports the file as busy, then succeeds', async () => {
    const rename = vi
      .fn<(from: string, to: string) => Promise<void>>()
      .mockRejectedValueOnce(fail('EPERM'))
      .mockRejectedValueOnce(fail('EBUSY'))
      .mockRejectedValueOnce(fail('EACCES'))
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn(async (_ms: number) => undefined);
    await renameWithRetry('a.tmp', 'a', { rename, sleep });
    expect(rename).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([20, 40, 80]);
  });

  it('gives up after about a second and a half', async () => {
    const rename = vi.fn(async () => {
      throw fail('EPERM');
    });
    const sleep = vi.fn(async (_ms: number) => undefined);
    await expect(renameWithRetry('a.tmp', 'a', { rename, sleep })).rejects.toMatchObject({ code: 'EPERM' });
    const waited = sleep.mock.calls.reduce((sum, c) => sum + c[0], 0);
    expect(waited).toBeGreaterThanOrEqual(1_000);
    expect(waited).toBeLessThanOrEqual(2_000);
  });

  it('does not retry other errors', async () => {
    const rename = vi.fn(async () => {
      throw fail('ENOENT');
    });
    const sleep = vi.fn(async (_ms: number) => undefined);
    await expect(renameWithRetry('a.tmp', 'a', { rename, sleep })).rejects.toMatchObject({ code: 'ENOENT' });
    expect(rename).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
