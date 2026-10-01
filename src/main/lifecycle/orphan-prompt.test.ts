import { describe, expect, it, vi } from 'vitest';
import { createMemoryLogger } from '../logger';
import type { ProcessInfo } from '../platform/adapter';
import { handleOrphans, type OrphanPromptDeps } from './orphan-prompt';

const entry = (pid: number, projectId = 'p1', script = 'dev') => ({ pid, startTime: 10_000, projectId, script });

function setup(previous = [entry(1000), entry(1001, 'p1::packages/api', 'api')], over: Partial<OrphanPromptDeps> = {}) {
  const base = {
    ledger: { previous: vi.fn(() => previous), dropPrevious: vi.fn() },
    // Both roots alive, plus a child of an exited root (2000 → 2001, 2002).
    listProcesses: vi.fn(async (): Promise<ProcessInfo[] | null> => [
      { pid: 1000, parentPid: 1, startTime: 10_000 },
      { pid: 1001, parentPid: 1, startTime: 10_000 },
      { pid: 2001, parentPid: 2000, startTime: 10_500 },
      { pid: 2002, parentPid: 2000, startTime: 10_600 },
    ]),
    killTree: vi.fn(async () => {}),
    projectLabel: vi.fn((id: string) => (id === 'p1' ? 'shop' : id === 'p1::packages/api' ? 'shop · api' : null)),
    ask: vi.fn(async () => true),
    logger: createMemoryLogger(),
  };
  return { ...base, ...over } as typeof base;
}

describe('handleOrphans', () => {
  it('does not ask without previous entries', async () => {
    const deps = setup([]);
    await handleOrphans(deps);
    expect(deps.ask).not.toHaveBeenCalled();
    expect(deps.ledger.dropPrevious).toHaveBeenCalled();
  });

  it('does not ask when no entry still matches', async () => {
    const deps = setup(undefined, { listProcesses: vi.fn(async () => []) });
    await handleOrphans(deps);
    expect(deps.ask).not.toHaveBeenCalled();
    expect(deps.ledger.dropPrevious).toHaveBeenCalled();
  });

  it('lists the survivors and stops them on request', async () => {
    const deps = setup();
    deps.killTree.mockRejectedValueOnce(new Error('denied'));
    await handleOrphans(deps);
    expect(deps.ask).toHaveBeenCalledWith(
      '2 scripts from the last session are still running',
      'shop · dev (PID 1000)\nshop · api · api (PID 1001)',
    );
    expect(deps.killTree.mock.calls).toEqual([[1000], [1001]]);
    expect(deps.logger.entries).toContainEqual({ level: 'warn', message: 'orphan kill failed', fields: { pid: 1000 } });
    expect(deps.ledger.dropPrevious).toHaveBeenCalled();
    expect(deps.logger.entries).toContainEqual({ level: 'info', message: 'orphan check', fields: { recorded: 2, running: 2 } });
  });

  it('stops the children of a root that has exited', async () => {
    const deps = setup([entry(2000)]);
    await handleOrphans(deps);
    expect(deps.ask).toHaveBeenCalledWith('1 script from the last session is still running', 'shop · dev (PID 2001, 2002)');
    expect(deps.killTree.mock.calls).toEqual([[2001], [2002]]);
  });

  it('keeps the entries for next time when the processes cannot be listed', async () => {
    const deps = setup(undefined, { listProcesses: vi.fn(async () => null) });
    await handleOrphans(deps);
    expect(deps.ask).not.toHaveBeenCalled();
    expect(deps.ledger.dropPrevious).not.toHaveBeenCalled();
  });

  it('does not list processes without previous entries', async () => {
    const deps = setup([]);
    await handleOrphans(deps);
    expect(deps.listProcesses).not.toHaveBeenCalled();
  });

  it('leaves them running when asked to', async () => {
    const deps = setup([entry(1000, 'gone')], { ask: vi.fn(async () => false) });
    await handleOrphans(deps);
    expect(deps.ask).toHaveBeenCalledWith('1 script from the last session is still running', 'unknown project · dev (PID 1000)');
    expect(deps.killTree).not.toHaveBeenCalled();
    expect(deps.ledger.dropPrevious).toHaveBeenCalled();
  });

  it('keeps the entries for next time when the check fails', async () => {
    const deps = setup(undefined, { ask: vi.fn(async () => Promise.reject(new Error('no window'))) });
    await handleOrphans(deps);
    expect(deps.logger.entries).toContainEqual({ level: 'error', message: 'orphan check failed', fields: undefined });
    expect(deps.ledger.dropPrevious).not.toHaveBeenCalled();
  });
});
