import { NestboxError } from '@shared/errors';
import { isRecord } from '@shared/is-record';
import {
  type AppSettings,
  CURRENT_SCHEMA_VERSION,
  defaultStoreData,
  type Project,
  type StoreData,
  StoreDataSchema,
} from '@shared/types';
import { errorCode } from '../error-code';
import type { Logger } from '../logger';
import type { StoreBackend } from './backend';
import { MIGRATIONS, migrate, type Migration, NewerSchemaError } from './migrations';

const READ_ONLY_MESSAGE = 'Settings are read-only; changes cannot be saved';

export class StoreService {
  private data: StoreData;
  /** Set when the file may be valid but cannot be read, written or backed up, or is from a newer app; saving could destroy it. */
  private readOnly = false;

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

  isReadOnly(): boolean {
    return this.readOnly;
  }

  /** Validates before persisting; on failure throws and leaves state untouched. */
  updateProjects(fn: (projects: Project[]) => Project[]): void {
    this.assertWritable();
    this.commit(StoreDataSchema.parse({ ...this.data, projects: fn([...this.data.projects]) }));
  }

  /** Validates before persisting; on failure throws and leaves state untouched. */
  updateSettings(fn: (settings: AppSettings) => AppSettings): void {
    this.assertWritable();
    this.commit(StoreDataSchema.parse({ ...this.data, settings: fn({ ...this.data.settings }) }));
  }

  private commit(next: StoreData): void {
    this.backend.write(next);
    this.data = next;
  }

  private assertWritable(): void {
    if (this.readOnly) throw new NestboxError('INTERNAL', READ_ONLY_MESSAGE);
  }

  private goReadOnly(reason: string, error?: unknown): void {
    this.readOnly = true;
    this.logger.warn('Store unavailable, running read-only', {
      reason,
      code: error === undefined ? null : errorCode(error),
    });
  }

  /** A write during load. A failure switches to read-only instead of throwing out of the constructor. */
  private tryWrite(data: StoreData, reason: string): void {
    try {
      this.backend.write(data);
    } catch (error) {
      this.goReadOnly(reason, error);
    }
  }

  private load(): StoreData {
    let raw: unknown;
    try {
      raw = this.backend.read();
    } catch (error) {
      // Only malformed JSON is corruption; EBUSY/EPERM and friends are transient and must not move the file.
      if (error instanceof SyntaxError) return this.reset('unreadable');
      this.goReadOnly('unavailable', error);
      return defaultStoreData();
    }
    if (raw === undefined || raw === null || (isRecord(raw) && Object.keys(raw).length === 0)) {
      const fresh = defaultStoreData();
      this.tryWrite(fresh, 'write-defaults');
      return fresh;
    }
    let migrated: unknown;
    try {
      migrated = migrate(raw, CURRENT_SCHEMA_VERSION, this.migrations);
    } catch (error) {
      if (error instanceof NewerSchemaError) return this.openNewer(raw);
      return this.reset('migration-failed');
    }
    const parsed = StoreDataSchema.safeParse(migrated);
    if (!parsed.success) return this.reset('invalid');
    if (migrated !== raw) this.tryWrite(parsed.data, 'write-migrated');
    return parsed.data;
  }

  /** Uses a newer file's data where it still parses, read-only, so a downgrade never loses it. */
  private openNewer(raw: unknown): StoreData {
    this.goReadOnly('newer-schema');
    const parsed = StoreDataSchema.safeParse(isRecord(raw) ? { ...raw, schemaVersion: CURRENT_SCHEMA_VERSION } : raw);
    return parsed.success ? parsed.data : defaultStoreData();
  }

  private reset(reason: string): StoreData {
    let backup: string | null;
    try {
      backup = this.backend.backupCorrupt();
    } catch (error) {
      this.goReadOnly(reason, error);
      return defaultStoreData();
    }
    this.logger.warn('Store reset to defaults', { reason, backup });
    const fresh = defaultStoreData();
    this.tryWrite(fresh, 'write-after-backup');
    return fresh;
  }
}
