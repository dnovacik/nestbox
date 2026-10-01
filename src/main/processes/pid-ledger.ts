import * as fs from 'node:fs';
import { z } from 'zod';
import { errorCode } from '../error-code';
import type { Logger } from '../logger';

export const LedgerEntrySchema = z.object({
  pid: z.number().int().positive(),
  /** epoch ms from processStartTime; null when it could not be read (such entries are never killed). */
  startTime: z.number().nullable(),
  projectId: z.string(),
  script: z.string(),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export interface PidLedger {
  /** Entries left by the previous session, read once at creation. */
  previous(): readonly LedgerEntry[];
  add(entry: LedgerEntry): void;
  remove(pid: number): void;
  /** Forgets the previous session's entries (after the orphan prompt) and rewrites the file. */
  dropPrevious(): void;
  /** Forgets everything and removes the file. Not used on quit: entries that survive a quit are deliberate. */
  clear(): void;
}

export interface LedgerFs {
  readFileSync(path: string, encoding: 'utf8'): string;
  writeFileSync(path: string, data: string): void;
  renameSync(from: string, to: string): void;
  rmSync(path: string, opts: { force: true }): void;
}

const nodeFs: LedgerFs = {
  readFileSync: (p, e) => fs.readFileSync(p, e),
  writeFileSync: (p, d) => fs.writeFileSync(p, d),
  renameSync: (a, b) => fs.renameSync(a, b),
  rmSync: (p, o) => fs.rmSync(p, o),
};

/**
 * Records the PIDs of processes Nestbox started, so a crash of Nestbox itself can be cleaned up on the
 * next start. Holds no command lines and no environment. Writes are atomic (temp file + rename) and
 * never throw: a failure is logged by error code only.
 */
export function createPidLedger(file: string, logger: Logger, io: LedgerFs = nodeFs): PidLedger {
  let previous = read();
  let current: LedgerEntry[] = [];

  function read(): LedgerEntry[] {
    let text: string;
    try {
      text = io.readFileSync(file, 'utf8');
    } catch {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error('not an array');
      return parsed.flatMap((entry) => {
        const result = LedgerEntrySchema.safeParse(entry);
        return result.success ? [result.data] : [];
      });
    } catch {
      logger.warn('pid ledger unreadable');
      return [];
    }
  }

  function persist(): void {
    try {
      if (previous.length === 0 && current.length === 0) {
        io.rmSync(file, { force: true });
        return;
      }
      // previous stays in the file until the orphan prompt is answered, so a second crash loses nothing.
      io.writeFileSync(`${file}.tmp`, JSON.stringify([...previous, ...current]));
      io.renameSync(`${file}.tmp`, file);
    } catch (error) {
      logger.warn('pid ledger write failed', { code: errorCode(error) });
    }
  }

  return {
    previous: () => previous,
    add(entry) {
      current = [...current.filter((e) => e.pid !== entry.pid), entry];
      persist();
    },
    remove(pid) {
      if (!current.some((e) => e.pid === pid)) return;
      current = current.filter((e) => e.pid !== pid);
      persist();
    },
    dropPrevious() {
      previous = [];
      persist();
    },
    clear() {
      previous = [];
      current = [];
      persist();
    },
  };
}
