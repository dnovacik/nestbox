export const MAX_LINE_CHARS = 8192;
export const MAX_PENDING_CHARS = 65_536;

/** One complete line: CRLF trimmed, only the text after the last lone CR (progress redraws), capped in length. */
function finish(raw: string): string {
  const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
  const cr = line.lastIndexOf('\r');
  const visible = cr === -1 ? line : line.slice(cr + 1);
  return visible.length > MAX_LINE_CHARS ? `${visible.slice(0, MAX_LINE_CHARS)}…` : visible;
}

/** Splits a byte stream into lines, decoding UTF-8 across chunk boundaries. */
export class LineSplitter {
  private readonly decoder = new TextDecoder('utf-8');
  private pending = '';

  get hasPending(): boolean {
    return this.pending.length > 0;
  }

  push(chunk: Uint8Array | string): string[] {
    this.pending += typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true });
    const parts = this.pending.split('\n');
    this.pending = parts.pop() ?? '';
    const lines = parts.map(finish);
    if (this.pending.length > MAX_PENDING_CHARS) {
      lines.push(finish(this.pending));
      this.pending = '';
    }
    return lines;
  }

  /** Emits the partial line, if any (called after a quiet period and on close). */
  flush(): string[] {
    this.pending += this.decoder.decode();
    if (this.pending.length === 0) return [];
    const line = finish(this.pending);
    this.pending = '';
    return [line];
  }
}
