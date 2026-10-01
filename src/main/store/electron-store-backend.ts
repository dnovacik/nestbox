import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import Store from 'electron-store';
import type { StoreData } from '@shared/types';
import type { StoreBackend } from './backend';

const NAME = 'config';

export function createElectronStoreBackend(userDataDir: string): StoreBackend {
  let store: Store<Record<string, unknown>> | null = null;
  const open = (): Store<Record<string, unknown>> => {
    // Throws SyntaxError on malformed JSON (StoreService treats only that as corruption); other errors (EBUSY, EPERM) leave the file alone.
    store ??= new Store<Record<string, unknown>>({
      name: NAME,
      cwd: userDataDir,
      clearInvalidConfig: false,
      accessPropertiesByDotNotation: false,
    });
    return store;
  };

  return {
    read: () => open().store,
    write: (data: StoreData) => {
      open().store = data as unknown as Record<string, unknown>;
    },
    backupCorrupt: () => {
      store = null;
      const file = join(userDataDir, `${NAME}.json`);
      if (!existsSync(file)) return null;
      const backup = join(userDataDir, `${NAME}.corrupt-${Date.now()}.json`);
      renameSync(file, backup);
      return backup;
    },
  };
}
