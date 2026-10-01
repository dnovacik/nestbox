import type { LogLine, LogSnapshot } from '@shared/processes';

/**
 * Where a log view gets its lines: a snapshot (all, or after a seq to fill a gap) and live batches.
 * Script output, a static server's request log and a Claude prompt's output are all sources.
 */
export interface LogSource {
  /** Identifies the stream: views with the same key share one store. */
  key: string;
  snapshot(afterSeq?: number): Promise<LogSnapshot>;
  /** Live batches; returns the unsubscribe function. */
  subscribe(onLines: (lines: LogLine[]) => void): () => void;
  clear(): Promise<void>;
}
