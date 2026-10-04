import { describe, expect, it, vi } from 'vitest';
import { NestboxError } from '@shared/errors';
import type { ProcessState } from '@shared/processes';
import { waitForScript } from './run-script';

/** A ProcessManager stand-in: `set` changes the script's state and fires 'changed'. */
function fakeProcesses(initial: ProcessState | null = null) {
  let state: { state: ProcessState; exit: { code: number | null } | null } | null = initial
    ? { state: initial, exit: null }
    : null;
  const listeners = new Set<(e: { type: 'changed' }) => void>();
  return {
    on: (l: (e: { type: 'changed' }) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    get: () => state,
    set(next: ProcessState, code: number | null = null) {
      state = { state: next, exit: next === 'running' ? null : { code } };
      for (const l of listeners) l({ type: 'changed' });
    },
    listeners,
  };
}

describe('waitForScript', () => {
  it('starts the script and resolves with its exit code', async () => {
    const p = fakeProcesses('exited');
    const start = vi.fn(async () => p.set('running'));
    const done = waitForScript({ processes: p, start, stop: vi.fn(), timeoutMs: 1_000 });
    await vi.waitFor(() => expect(start).toHaveBeenCalled());
    p.set('exited', 0);
    expect(await done).toEqual({ outcome: 'exited', code: 0 });
    expect(p.listeners.size).toBe(0);
  });

  it('reports a crash with its code', async () => {
    const p = fakeProcesses();
    const done = waitForScript({
      processes: p,
      start: async () => p.set('running'),
      stop: vi.fn(),
      timeoutMs: 1_000,
    });
    await Promise.resolve();
    p.set('crashed', 2);
    expect(await done).toEqual({ outcome: 'crashed', code: 2 });
  });

  it('sees an exit that happened before it subscribed', async () => {
    const p = fakeProcesses();
    const start = async () => {
      p.set('running');
      p.set('crashed', 1);
    };
    expect(await waitForScript({ processes: p, start, stop: vi.fn(), timeoutMs: 1_000 })).toEqual({
      outcome: 'crashed',
      code: 1,
    });
  });

  it('answers busy when the script is already running', async () => {
    const p = fakeProcesses('running');
    const start = async () => {
      throw new NestboxError('CONFLICT', 'already running');
    };
    expect(await waitForScript({ processes: p, start, stop: vi.fn(), timeoutMs: 1_000 })).toEqual({
      outcome: 'busy',
      code: null,
    });
  });

  it('stops a script that runs past the timeout', async () => {
    const p = fakeProcesses();
    const stop = vi.fn(async () => p.set('stopped'));
    expect(
      await waitForScript({
        processes: p,
        start: async () => p.set('running'),
        stop,
        timeoutMs: 20,
      }),
    ).toEqual({ outcome: 'timeout', code: null });
    expect(stop).toHaveBeenCalled();
  });
});
