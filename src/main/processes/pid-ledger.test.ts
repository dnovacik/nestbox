import { describe, expect, it } from 'vitest';
import { createMemoryLogger } from '../logger';
import { createPidLedger, type LedgerFs } from './pid-ledger';

const FILE = '/data/processes.json';
const entry = (pid: number) => ({ pid, startTime: 1000 + pid, projectId: 'p1', script: `s${pid}` });

function memoryFs(initial?: string) {
  const files = new Map<string, string>();
  if (initial !== undefined) files.set(FILE, initial);
  const renames: [string, string][] = [];
  const io: LedgerFs = {
    readFileSync: (p) => {
      const v = files.get(p);
      if (v === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return v;
    },
    writeFileSync: (p, d) => void files.set(p, d),
    renameSync: (a, b) => {
      renames.push([a, b]);
      files.set(b, files.get(a) ?? '');
      files.delete(a);
    },
    rmSync: (p) => void files.delete(p),
  };
  const content = (): unknown => (files.has(FILE) ? JSON.parse(files.get(FILE) ?? '') : undefined);
  return { io, files, renames, content };
}

describe('PidLedger', () => {
  it('reads nothing when the file is missing', () => {
    expect(createPidLedger(FILE, createMemoryLogger(), memoryFs().io).previous()).toEqual([]);
  });

  it('treats invalid JSON as empty and warns', () => {
    const logger = createMemoryLogger();
    expect(createPidLedger(FILE, logger, memoryFs('{nope').io).previous()).toEqual([]);
    expect(logger.entries).toContainEqual({ level: 'warn', message: 'pid ledger unreadable', fields: undefined });
  });

  it('keeps the valid entries of a partly invalid file', () => {
    const fs = memoryFs(JSON.stringify([entry(1), { pid: 'x' }, entry(2)]));
    expect(createPidLedger(FILE, createMemoryLogger(), fs.io).previous()).toEqual([entry(1), entry(2)]);
  });

  it('writes previous and current entries atomically', () => {
    const fs = memoryFs(JSON.stringify([entry(1)]));
    const ledger = createPidLedger(FILE, createMemoryLogger(), fs.io);
    ledger.add(entry(5));
    expect(fs.renames).toEqual([[`${FILE}.tmp`, FILE]]);
    expect(fs.content()).toEqual([entry(1), entry(5)]);
    ledger.remove(5);
    expect(fs.content()).toEqual([entry(1)]);
  });

  it('drops the previous entries and removes an empty file', () => {
    const fs = memoryFs(JSON.stringify([entry(1)]));
    const ledger = createPidLedger(FILE, createMemoryLogger(), fs.io);
    ledger.dropPrevious();
    expect(ledger.previous()).toEqual([]);
    expect(fs.files.has(FILE)).toBe(false);
  });

  it('keeps current entries when dropping previous ones', () => {
    const fs = memoryFs(JSON.stringify([entry(1)]));
    const ledger = createPidLedger(FILE, createMemoryLogger(), fs.io);
    ledger.add(entry(7));
    ledger.dropPrevious();
    expect(fs.content()).toEqual([entry(7)]);
  });

  it('clear removes the file', () => {
    const fs = memoryFs();
    const ledger = createPidLedger(FILE, createMemoryLogger(), fs.io);
    ledger.add(entry(3));
    ledger.clear();
    expect(fs.files.has(FILE)).toBe(false);
  });

  it('never throws when a write fails', () => {
    const fs = memoryFs();
    fs.io.writeFileSync = () => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    };
    const logger = createMemoryLogger();
    const ledger = createPidLedger(FILE, logger, fs.io);
    expect(() => ledger.add(entry(3))).not.toThrow();
    expect(logger.entries).toContainEqual({ level: 'warn', message: 'pid ledger write failed', fields: { code: 'EPERM' } });
  });
});
