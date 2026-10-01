import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { LogLine } from '@shared/processes';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/queries';
import { subscribeToolEvent } from '@/lib/tool-events';
import { LogLineStore } from './line-store';

const DEFAULT_CAP = 50_000;
/** A failed snapshot (e.g. the project is still being detected) is retried after this long. */
export const RETRY_MS = 2_000;
const EMPTY: readonly LogLine[] = [];

interface Shared {
  store: LogLineStore;
  refs: number;
  status: 'loading' | 'ready' | 'error';
  statusListeners: Set<() => void>;
  dispose: () => void;
}

/** One store per (project, script), shared by every mounted pane and dropped when the last one unmounts. */
const streams = new Map<string, Shared>();

function acquire(projectId: string, script: string, cap: number): Shared {
  const key = JSON.stringify([projectId, script]);
  const existing = streams.get(key);
  if (existing) {
    existing.refs++;
    return existing;
  }
  const store = new LogLineStore(cap);
  let disposed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const shared: Shared = { store, refs: 1, status: 'loading', statusListeners: new Set(), dispose: () => {} };
  const setStatus = (status: Shared['status']): void => {
    shared.status = status;
    for (const listener of shared.statusListeners) listener();
  };
  const fetch = async (mode: 'replace' | 'delta'): Promise<void> => {
    try {
      const snap = await api.tools.invoke(
        'scripts',
        projectId,
        'getLogs',
        mode === 'delta' ? { script, afterSeq: store.lastSeq } : { script },
      );
      if (disposed) return;
      setStatus('ready');
      if (store.applySnapshot(snap, mode) === 'gap') void fetch('delta');
    } catch {
      if (disposed) return;
      setStatus('error');
      retry = setTimeout(() => void fetch(mode), RETRY_MS);
    }
  };
  // Subscribe before fetching, so no batch emitted after the snapshot can be missed.
  const off = subscribeToolEvent('scripts', projectId, 'logs', (payload) => {
    if (payload.script === script && store.append(payload.lines) === 'gap') void fetch('delta');
  });
  shared.dispose = () => {
    disposed = true;
    clearTimeout(retry);
    off();
  };
  streams.set(key, shared);
  void fetch('replace');
  return shared;
}

function release(projectId: string, script: string): void {
  const key = JSON.stringify([projectId, script]);
  const shared = streams.get(key);
  if (!shared) return;
  shared.refs--;
  if (shared.refs === 0) {
    shared.dispose();
    streams.delete(key);
  }
}

const noopSubscribe = () => () => {};

export function useLogStream(projectId: string, script: string | null) {
  const cap = useSettings().data?.logBufferLines ?? DEFAULT_CAP;
  const [shared, setShared] = useState<Shared | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (script === null) return;
    const acquired = acquire(projectId, script, cap);
    const onStatus = () => setTick((n) => n + 1);
    acquired.statusListeners.add(onStatus);
    setShared(acquired);
    return () => {
      acquired.statusListeners.delete(onStatus);
      release(projectId, script);
      setShared(null);
    };
    // cap changes are applied below without re-subscribing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, script]);

  useEffect(() => {
    shared?.store.setCap(cap);
  }, [shared, cap]);

  const lines = useSyncExternalStore(shared?.store.subscribe ?? noopSubscribe, shared?.store.getSnapshot ?? (() => EMPTY));

  const clear = useCallback(async () => {
    if (script === null) return;
    await api.tools.invoke('scripts', projectId, 'clearLogs', { script });
    shared?.store.clear();
  }, [projectId, script, shared]);

  return { lines, status: script === null ? ('ready' as const) : (shared?.status ?? 'loading'), clear };
}
