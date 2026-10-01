import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { LogLine } from '@shared/processes';
import { useSettings } from '@/lib/queries';
import { LogLineStore } from './line-store';
import type { LogSource } from './log-source';

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

/** One store per source key, shared by every mounted view and dropped when the last one unmounts. */
const streams = new Map<string, Shared>();

function acquire(source: LogSource, cap: number): Shared {
  const key = source.key;
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
      const snap = await source.snapshot(mode === 'delta' ? store.lastSeq : undefined);
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
  const off = source.subscribe((lines) => {
    if (store.append(lines) === 'gap') void fetch('delta');
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

function release(key: string): void {
  const shared = streams.get(key);
  if (!shared) return;
  shared.refs--;
  if (shared.refs === 0) {
    shared.dispose();
    streams.delete(key);
  }
}

const noopSubscribe = () => () => {};

/** Lines of a log source (null: nothing picked yet), kept live; the buffer cap follows the setting. */
export function useLogStream(source: LogSource | null) {
  const cap = useSettings().data?.logBufferLines ?? DEFAULT_CAP;
  const [shared, setShared] = useState<Shared | null>(null);
  const [, setTick] = useState(0);
  const key = source?.key ?? null;

  useEffect(() => {
    if (source === null) return;
    const acquired = acquire(source, cap);
    const onStatus = () => setTick((n) => n + 1);
    acquired.statusListeners.add(onStatus);
    setShared(acquired);
    return () => {
      acquired.statusListeners.delete(onStatus);
      release(source.key);
      setShared(null);
    };
    // Re-subscribe only when the stream changes (a new source object with the same key is the same
    // stream); cap changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    shared?.store.setCap(cap);
  }, [shared, cap]);

  const lines = useSyncExternalStore(shared?.store.subscribe ?? noopSubscribe, shared?.store.getSnapshot ?? (() => EMPTY));

  const clear = useCallback(async () => {
    if (source === null) return;
    await source.clear();
    shared?.store.clear();
  }, [source, shared]);

  return { lines, status: source === null ? ('ready' as const) : (shared?.status ?? 'loading'), clear };
}
