import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGitWatcher, type WatchFn } from './watcher';

const dirs = { gitDir: '/r/.git', commonDir: '/r/.git' };

function fakeWatch() {
  const watchers: { dir: string; recursive: boolean; onChange: (name: string | null) => void; stopped: boolean }[] = [];
  const watch: WatchFn = vi.fn((dir, recursive, onChange) => {
    const w = { dir, recursive, onChange, stopped: false };
    watchers.push(w);
    return () => void (w.stopped = true);
  });
  const fire = (dir: string, name: string | null) => watchers.filter((w) => w.dir === dir && !w.stopped).forEach((w) => w.onChange(name));
  return { watch, watchers, fire };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createGitWatcher', () => {
  it('watches the gitdir and, recursively, the refs', () => {
    const { watch, watchers } = fakeWatch();
    createGitWatcher(watch).ensure('p1', 'p1', dirs, vi.fn());
    expect(watchers.map((w) => [w.dir, w.recursive])).toEqual([
      ['/r/.git', false],
      ['/r/.git/refs', true],
    ]);
  });

  it('emits once, 300 ms after the last change', () => {
    const { watch, fire } = fakeWatch();
    const emit = vi.fn();
    createGitWatcher(watch).ensure('p1', 'p1', dirs, emit);
    fire('/r/.git', 'index');
    vi.advanceTimersByTime(200);
    fire('/r/.git/refs', 'heads/main');
    vi.advanceTimersByTime(299);
    expect(emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('emits at most once a second', () => {
    const { watch, fire } = fakeWatch();
    const emit = vi.fn();
    createGitWatcher(watch).ensure('p1', 'p1', dirs, emit);
    fire('/r/.git', 'index');
    vi.advanceTimersByTime(300);
    fire('/r/.git', 'HEAD');
    vi.advanceTimersByTime(300);
    expect(emit).toHaveBeenCalledTimes(1);
    // The first went out at 300 ms, so the next waits until 1 300 ms.
    vi.advanceTimersByTime(699);
    expect(emit).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('ignores lock files', () => {
    const { watch, fire } = fakeWatch();
    const emit = vi.fn();
    createGitWatcher(watch).ensure('p1', 'p1', dirs, emit);
    fire('/r/.git', 'index.lock');
    fire('/r/.git/refs', 'heads/main.lock');
    vi.advanceTimersByTime(2_000);
    expect(emit).not.toHaveBeenCalled();
  });

  it('keeps one watcher per project, takes the newest emit, and restarts when the dirs change', () => {
    const { watch, watchers, fire } = fakeWatch();
    const w = createGitWatcher(watch);
    const first = vi.fn();
    const second = vi.fn();
    w.ensure('p1', 'p1', dirs, first);
    w.ensure('p1', 'p1', dirs, second);
    expect(watchers).toHaveLength(2);
    fire('/r/.git', 'HEAD');
    vi.advanceTimersByTime(300);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    w.ensure('p1', 'p1', { gitDir: '/moved/.git', commonDir: '/moved/.git' }, second);
    expect(watchers.slice(0, 2).every((x) => x.stopped)).toBe(true);
    expect(watchers.slice(2).map((x) => x.dir)).toEqual(['/moved/.git', '/moved/.git/refs']);
  });

  it('retries next time when the gitdir cannot be watched, and still works without refs', () => {
    let fail = true;
    const watch: WatchFn = vi.fn((dir) => (fail || dir.endsWith('refs') ? null : () => undefined));
    const w = createGitWatcher(watch);
    w.ensure('p1', 'p1', dirs, vi.fn());
    fail = false;
    w.ensure('p1', 'p1', dirs, vi.fn());
    w.ensure('p1', 'p1', dirs, vi.fn());
    // gitdir (failed), then gitdir + refs, then nothing new.
    expect(vi.mocked(watch).mock.calls.map((c) => c[0])).toEqual(['/r/.git', '/r/.git', '/r/.git/refs']);
  });

  it('stops the watchers of a removed root and on dispose', () => {
    const { watch, watchers, fire } = fakeWatch();
    const w = createGitWatcher(watch);
    const emit = vi.fn();
    w.ensure('a', 'a', dirs, emit);
    w.ensure('b', 'b', { gitDir: '/b/.git', commonDir: '/b/.git' }, emit);
    fire('/r/.git', 'HEAD');
    w.forgetRoot('a');
    vi.advanceTimersByTime(1_000);
    expect(emit).not.toHaveBeenCalled();
    expect(watchers.filter((x) => x.stopped).map((x) => x.dir)).toEqual(['/r/.git', '/r/.git/refs']);
    w.disposeAll();
    expect(watchers.every((x) => x.stopped)).toBe(true);
  });
});
