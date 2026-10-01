import type { StoreData } from '@shared/types';

export interface StoreBackend {
  /** Raw persisted value. May throw (e.g. malformed JSON). */
  read(): unknown;
  write(data: StoreData): void;
  /** Moves the current file aside; returns the backup location or null if there was nothing to move. */
  backupCorrupt(): string | null;
}

export function createMemoryBackend(initial?: unknown): StoreBackend & { data: unknown; backups: number } {
  const backend = {
    data: initial,
    backups: 0,
    read(): unknown {
      return backend.data;
    },
    write(data: StoreData): void {
      backend.data = structuredClone(data);
    },
    backupCorrupt(): string | null {
      backend.backups++;
      backend.data = undefined;
      return `memory-backup-${backend.backups}`;
    },
  };
  return backend;
}
