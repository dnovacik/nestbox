import type { LogLine, LogSnapshot } from '@shared/processes';

export type ApplyStatus = 'ok' | 'gap';

/**
 * The renderer's copy of one script's log. Lines arrive as a snapshot (getLogs) plus 50 ms batches
 * (tools:event). Batches that arrive before a snapshot, or while a resync is outstanding, are queued
 * and merged by seq, so nothing is shown twice. A batch that skips seqs reports 'gap': the caller
 * fetches getLogs({ afterSeq: lastSeq }) and applies it as a delta.
 */
export class LogLineStore {
  private lines: readonly LogLine[] = [];
  private last = 0;
  private ready = false;
  private pending: LogLine[] = [];
  /** Lines accepted by appendContiguous, not yet published. */
  private collected: LogLine[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(private cap: number) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): readonly LogLine[] => this.lines;

  get lastSeq(): number {
    return this.last;
  }

  get isReady(): boolean {
    return this.ready;
  }

  setCap(cap: number): void {
    if (cap === this.cap) return;
    this.cap = cap;
    if (this.lines.length > cap) this.update(this.lines.slice(-cap));
  }

  applySnapshot(snap: LogSnapshot, mode: 'replace' | 'delta'): ApplyStatus {
    const base = mode === 'replace' ? [] : this.lines;
    const fresh = mode === 'replace' ? snap.lines : snap.lines.filter((l) => l.seq > this.last);
    this.last = Math.max(mode === 'replace' ? 0 : this.last, snap.lastSeq, fresh.at(-1)?.seq ?? 0);
    this.ready = true;
    const queued = this.pending;
    this.pending = [];
    const status = this.appendContiguous(queued);
    this.update([...base, ...fresh, ...this.collected].slice(-this.cap));
    this.collected = [];
    return status;
  }

  /** Lines queued while waiting for a snapshot; bounded by the cap. */
  get pendingSize(): number {
    return this.pending.length;
  }

  append(batch: readonly LogLine[]): ApplyStatus {
    if (!this.ready) {
      this.pending.push(...batch);
      // Only the newest `cap` lines could ever be shown; older ones would be dropped on apply anyway.
      if (this.pending.length > this.cap) this.pending = this.pending.slice(-this.cap);
      return 'ok';
    }
    const status = this.appendContiguous(batch);
    if (this.collected.length > 0) this.update([...this.lines, ...this.collected].slice(-this.cap));
    this.collected = [];
    return status;
  }

  clear(): void {
    this.update([]);
  }

  /** Moves contiguous new lines into `collected`; on a gap, queues the rest and waits for a delta. */
  private appendContiguous(batch: readonly LogLine[]): ApplyStatus {
    const fresh = batch.filter((l) => l.seq > this.last);
    for (let i = 0; i < fresh.length; i++) {
      const line = fresh[i];
      if (!line) continue;
      if (line.seq > this.last + 1) {
        this.ready = false;
        this.pending.push(...fresh.slice(i));
        return 'gap';
      }
      this.collected.push(line);
      this.last = line.seq;
    }
    return 'ok';
  }

  private update(lines: readonly LogLine[]): void {
    this.lines = lines;
    for (const listener of this.listeners) listener();
  }
}
