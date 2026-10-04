// What the inspector keeps of a request or response: headers as received and a capped copy of the body.
// Everything stays in memory; header values that look secret are masked in what the renderer gets.
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import {
  CAPTURE_BYTES,
  type BodyView,
  type EntrySummary,
  type HeaderView,
  MAX_ENTRIES,
  type SideView,
} from '@shared/tools/inspector/contract';

export type HeaderPairs = [name: string, value: string][];

export interface RecordedSide {
  headers: HeaderPairs;
  body: Buffer;
  /** The body's full size, of which `body` holds the first CAPTURE_BYTES. */
  bytes: number;
}

export interface Entry {
  id: string;
  at: number;
  method: string;
  path: string;
  request: RecordedSide;
  response: (RecordedSide & { status: number }) | null;
  ms: number | null;
  replayOf: string | null;
  error: string | null;
}

/** A body copy that stops growing at `limit` but keeps counting. */
export class Capture {
  private readonly chunks: Buffer[] = [];
  private kept = 0;
  bytes = 0;

  constructor(private readonly limit = CAPTURE_BYTES) {}

  push(chunk: Buffer): void {
    this.bytes += chunk.length;
    if (this.kept >= this.limit) return;
    const part = chunk.subarray(0, this.limit - this.kept);
    this.chunks.push(part);
    this.kept += part.length;
  }

  buffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

/** Node's rawHeaders ([name, value, name, value, …]) as pairs, keeping the sender's casing and order. */
export function headerPairs(raw: readonly string[]): HeaderPairs {
  const out: HeaderPairs = [];
  for (let i = 0; i + 1 < raw.length; i += 2) out.push([raw[i] as string, raw[i + 1] as string]);
  return out;
}

const SECRET_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'cf-connecting-ip',
]);
const SECRET_PATTERN = /token|secret|password|api[-_]?key|session/i;
export const MASK = '••••••';

export function isMasked(name: string): boolean {
  return SECRET_NAMES.has(name.toLowerCase()) || SECRET_PATTERN.test(name);
}

export function headerOf(headers: HeaderPairs, name: string): string | null {
  const lower = name.toLowerCase();
  return headers.find(([n]) => n.toLowerCase() === lower)?.[1] ?? null;
}

const TEXTUAL =
  /^(text\/|application\/(json|[\w.+-]+\+json|xml|[\w.+-]+\+xml|javascript|x-www-form-urlencoded|graphql|x-ndjson))/i;

function decode(body: Buffer, encoding: string | null): Buffer | null {
  try {
    switch ((encoding ?? '').trim().toLowerCase()) {
      case '':
      case 'identity':
        return body;
      case 'gzip':
      case 'x-gzip':
        return gunzipSync(body);
      case 'deflate':
        return inflateSync(body);
      case 'br':
        return brotliDecompressSync(body);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export function bodyView(side: RecordedSide): BodyView {
  if (side.bytes === 0) return { kind: 'none' };
  const truncated = side.bytes > side.body.length;
  const contentType = headerOf(side.headers, 'content-type');
  const encoding = headerOf(side.headers, 'content-encoding');
  // A cut-off compressed body can't be decoded.
  const plain = truncated && encoding ? null : decode(side.body, encoding);
  if (plain && (contentType === null || TEXTUAL.test(contentType))) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(plain);
      return { kind: 'text', text, truncated, contentType };
    } catch {
      // Not UTF-8: shown as binary.
    }
  }
  return { kind: 'binary', bytes: side.bytes, truncated };
}

export function sideView(side: RecordedSide): SideView {
  const headers: HeaderView[] = side.headers.map(([name, value]) =>
    isMasked(name) ? { name, value: MASK, masked: true } : { name, value, masked: false },
  );
  return { headers, body: bodyView(side) };
}

export function summarize(e: Entry): EntrySummary {
  return {
    id: e.id,
    at: e.at,
    method: e.method,
    path: e.path,
    status: e.response?.status ?? null,
    ms: e.ms,
    reqBytes: e.request.bytes,
    resBytes: e.response?.bytes ?? 0,
    replayOf: e.replayOf,
    tunnel: headerOf(e.request.headers, 'cf-ray') !== null,
    error: e.error,
  };
}

/** The last MAX_ENTRIES entries, oldest first. */
export class EntryRing {
  private entries: Entry[] = [];

  constructor(private readonly max = MAX_ENTRIES) {}

  add(entry: Entry): void {
    this.entries.push(entry);
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max);
  }

  get(id: string): Entry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  newestFirst(): Entry[] {
    return [...this.entries].reverse();
  }

  get size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries = [];
  }
}
