// Whether the database server answers: a plain TCP connect, no credentials and no driver. SQLite checks
// that its file exists. A "reachable" server may still refuse the login (Test login checks that).
import { stat } from 'node:fs/promises';
import { connect as netConnect } from 'node:net';
import type { DbTarget } from './url';

export type ReachResult = 'reachable' | 'refused' | 'timeout' | 'dns' | 'missing-file' | 'not-checked';

export interface Reach {
  result: ReachResult;
  /** Why it was not checked, or the error code: shown in the panel, never contains the URL. */
  reason: string | null;
}

interface SocketLike {
  once(event: 'connect' | 'error', listener: (error?: NodeJS.ErrnoException) => void): unknown;
  setTimeout(ms: number, listener: () => void): unknown;
  destroy(): unknown;
}

export interface ReachOptions {
  connect?: (port: number, host: string) => SocketLike;
  timeoutMs?: number;
}

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'EAI_NONAME']);
const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH']);

export async function checkReachable(target: DbTarget, opts: ReachOptions = {}): Promise<Reach> {
  if (target.provider === 'sqlite') {
    if (!target.file) return { result: 'not-checked', reason: 'No SQLite file in the URL' };
    const file = await stat(target.file).catch(() => null);
    return file?.isFile() ? { result: 'reachable', reason: null } : { result: 'missing-file', reason: 'The SQLite file does not exist yet' };
  }
  if (target.provider === 'accelerate') return { result: 'not-checked', reason: 'Prisma Accelerate URLs go through a proxy' };
  if (target.provider === 'unknown' || target.host === null) return { result: 'not-checked', reason: 'The URL was not recognised' };
  if (target.port === null) return { result: 'not-checked', reason: 'mongodb+srv finds its servers through DNS SRV records' };

  const connect = opts.connect ?? ((port: number, host: string) => netConnect({ port, host }));
  const timeoutMs = opts.timeoutMs ?? 3_000;
  const { host, port } = target;
  return new Promise<Reach>((resolve) => {
    let done = false;
    const socket = connect(port, host);
    const finish = (reach: Reach) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(reach);
    };
    socket.setTimeout(timeoutMs, () => finish({ result: 'timeout', reason: `No answer within ${timeoutMs / 1000} s` }));
    socket.once('connect', () => finish({ result: 'reachable', reason: null }));
    socket.once('error', (error) => {
      const code = error?.code ?? 'ERROR';
      if (DNS_CODES.has(code)) finish({ result: 'dns', reason: code });
      else if (TIMEOUT_CODES.has(code)) finish({ result: 'timeout', reason: code });
      else finish({ result: 'refused', reason: code });
    });
  });
}
