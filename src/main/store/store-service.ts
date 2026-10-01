import { isRecord } from '@shared/is-record';
import {
  type AppSettings,
  CURRENT_SCHEMA_VERSION,
  defaultStoreData,
  type Project,
  type StoreData,
  StoreDataSchema,
} from '@shared/types';
import type { Logger } from '../logger';
import type { StoreBackend } from './backend';
import { MIGRATIONS, migrate, type Migration } from './migrations';

export class StoreService {
  private data: StoreData;

  constructor(
    private readonly backend: StoreBackend,
    private readonly logger: Logger,
    private readonly migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  ) {
    this.data = this.load();
  }

  getProjects(): readonly Project[] {
    return this.data.projects;
  }

  getSettings(): AppSettings {
    return this.data.settings;
  }

  /** Validates before persisting; on failure throws and leaves state untouched. */
  updateProjects(fn: (projects: Project[]) => Project[]): void {
    const next = StoreDataSchema.parse({ ...this.data, projects: fn([...this.data.projects]) });
    this.backend.write(next);
    this.data = next;
  }

  private load(): StoreData {
    let raw: unknown;
    try {
      raw = this.backend.read();
    } catch {
      return this.reset('unreadable');
    }
    if (raw === undefined || raw === null || (isRecord(raw) && Object.keys(raw).length === 0)) {
      const fresh = defaultStoreData();
      this.backend.write(fresh);
      return fresh;
    }
    let migrated: unknown;
    try {
      migrated = migrate(raw, CURRENT_SCHEMA_VERSION, this.migrations);
    } catch {
      return this.reset('migration-failed');
    }
    const parsed = StoreDataSchema.safeParse(migrated);
    if (!parsed.success) return this.reset('invalid');
    if (migrated !== raw) this.backend.write(parsed.data);
    return parsed.data;
  }

  private reset(reason: string): StoreData {
    const backup = this.backend.backupCorrupt();
    this.logger.warn('Store reset to defaults', { reason, backup });
    const fresh = defaultStoreData();
    this.backend.write(fresh);
    return fresh;
  }
}
