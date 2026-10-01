import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryLogger } from '../logger';
import { createQuitController, type QuitControllerDeps } from './quit-controller';

const event = () => ({ preventDefault: vi.fn() });

function setup(over: Partial<QuitControllerDeps> = {}) {
  const base = {
    liveCount: vi.fn(() => 0),
    confirmQuit: vi.fn(async () => true),
    shutdown: vi.fn(async () => {}),
    quit: vi.fn(),
    closeToTray: vi.fn(() => true),
    hideWindow: vi.fn(),
    logger: createMemoryLogger(),
    timeoutMs: 5_000,
  };
  const deps = { ...base, ...over } as typeof base;
  return { deps, qc: createQuitController(deps) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('quit controller', () => {
  it('hides the window on close with close to tray', () => {
    const { deps, qc } = setup();
    const e = event();
    qc.onWindowClose(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(deps.hideWindow).toHaveBeenCalled();
    expect(deps.quit).not.toHaveBeenCalled();
  });

  it('quits on close without close to tray', async () => {
    const { deps, qc } = setup({ closeToTray: vi.fn(() => false) });
    const e = event();
    qc.onWindowClose(e);
    expect(e.preventDefault).toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(deps.shutdown).toHaveBeenCalled();
    expect(deps.quit).toHaveBeenCalled();
  });

  it('quits without asking when nothing runs', async () => {
    const { deps, qc } = setup();
    expect(await qc.requestQuit()).toBe(true);
    expect(deps.confirmQuit).not.toHaveBeenCalled();
    expect(deps.shutdown).toHaveBeenCalled();
    expect(deps.quit).toHaveBeenCalledTimes(1);
  });

  it('asks before stopping running scripts, and stays when cancelled', async () => {
    const { deps, qc } = setup({ liveCount: vi.fn(() => 2), confirmQuit: vi.fn(async () => false) });
    expect(await qc.requestQuit()).toBe(false);
    expect(deps.confirmQuit).toHaveBeenCalledWith(2);
    expect(deps.shutdown).not.toHaveBeenCalled();
    expect(deps.quit).not.toHaveBeenCalled();
    deps.confirmQuit.mockResolvedValueOnce(true);
    expect(await qc.requestQuit()).toBe(true);
    expect(deps.shutdown).toHaveBeenCalled();
  });

  it('prevents the first before-quit and lets the second through', async () => {
    const { deps, qc } = setup();
    const first = event();
    qc.onBeforeQuit(first);
    expect(first.preventDefault).toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(deps.quit).toHaveBeenCalledTimes(1);
    const second = event();
    qc.onBeforeQuit(second);
    expect(second.preventDefault).not.toHaveBeenCalled();
    const close = event();
    qc.onWindowClose(close);
    expect(close.preventDefault).not.toHaveBeenCalled();
  });

  it('quits after the timeout when shutdown hangs, and logs it', async () => {
    const { deps, qc } = setup({ shutdown: vi.fn(() => new Promise<void>(() => {})) });
    const quitting = qc.requestQuit();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(deps.quit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await quitting).toBe(true);
    expect(deps.quit).toHaveBeenCalled();
    expect(deps.logger.entries).toContainEqual({ level: 'warn', message: 'shutdown timed out', fields: { ms: 5_000 } });
  });

  it('quits even when shutdown fails, and logs it', async () => {
    const { deps, qc } = setup({ shutdown: vi.fn(async () => Promise.reject(new Error('x'))) });
    expect(await qc.requestQuit()).toBe(true);
    expect(deps.quit).toHaveBeenCalled();
    expect(deps.logger.entries).toContainEqual({ level: 'error', message: 'shutdown failed', fields: undefined });
  });

  it('ignores a second request while one is in flight', async () => {
    let answer!: (ok: boolean) => void;
    const { deps, qc } = setup({ liveCount: vi.fn(() => 1), confirmQuit: vi.fn(() => new Promise<boolean>((r) => (answer = r))) });
    const first = qc.requestQuit();
    expect(await qc.requestQuit()).toBe(false);
    answer(true);
    expect(await first).toBe(true);
    expect(deps.confirmQuit).toHaveBeenCalledTimes(1);
  });

  it('does not ask on session end', async () => {
    const { deps, qc } = setup({ liveCount: vi.fn(() => 3) });
    qc.onSessionEnd();
    await vi.runAllTimersAsync();
    expect(deps.confirmQuit).not.toHaveBeenCalled();
    expect(deps.shutdown).toHaveBeenCalled();
    expect(deps.quit).toHaveBeenCalled();
  });
});
