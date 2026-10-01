// A tool's own log (static requests, Claude prompt output): a ring buffer plus a 50 ms batched `logs` event,
// read by the renderer's LogView like a script log.
import type { LogLine, LogSnapshot } from '@shared/processes';
import { RingBuffer } from '../processes/ring-buffer';

const BATCH_MS = 50;

export class BatchedLog {
  private readonly lines: RingBuffer<LogLine>;
  private seq = 0;
  private pending: LogLine[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  /** emit is replaced on every call that has a fresher one (tool contexts are built per call). */
  constructor(
    capacity: number,
    public emit: (lines: LogLine[]) => void,
  ) {
    this.lines = new RingBuffer(capacity);
  }

  push(stream: LogLine['stream'], text: string): void {
    if (this.disposed) return;
    const line: LogLine = { seq: ++this.seq, ts: Date.now(), stream, text };
    this.lines.push(line);
    this.pending.push(line);
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      const lines = this.pending.splice(0);
      if (lines.length > 0) this.emit(lines);
    }, BATCH_MS);
  }

  snapshot(afterSeq?: number): LogSnapshot {
    const lines = afterSeq === undefined ? this.lines.toArray() : this.lines.after(afterSeq);
    return { lines, firstSeq: this.lines.toArray()[0]?.seq ?? this.seq + 1, lastSeq: this.seq };
  }

  /** Drops the lines, including a batch not sent yet. Sequence numbers carry on. */
  clear(): void {
    this.lines.clear();
    this.pending = [];
  }

  /** Drops the pending batch; later pushes are ignored and nothing is emitted. */
  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = [];
  }
}
