import { describe, expect, it } from 'vitest';
import { migrate, MigrationError, NewerSchemaError } from './migrations';

describe('migrate', () => {
  it('returns data unchanged when already at the target version', () => {
    const raw = { schemaVersion: 1, settings: {}, projects: [] };
    expect(migrate(raw, 1, {})).toEqual(raw);
  });

  it('applies migrations step by step and bumps schemaVersion', () => {
    const table = {
      0: (d: Record<string, unknown>) => ({ ...d, settings: {} }),
      1: (d: Record<string, unknown>) => ({ ...d, projects: [] }),
    };
    expect(migrate({ schemaVersion: 0 }, 2, table)).toEqual({ schemaVersion: 2, settings: {}, projects: [] });
  });

  it.each([
    ['a non-object', [1, 2]],
    ['a missing version', { projects: [] }],
  ])('rejects %s', (_label, raw) => {
    expect(() => migrate(raw, 1, {})).toThrow(MigrationError);
  });

  it('rejects a newer version with NewerSchemaError', () => {
    expect(() => migrate({ schemaVersion: 9 }, 1, {})).toThrow(NewerSchemaError);
  });

  it('rejects a gap in the migration table', () => {
    expect(() => migrate({ schemaVersion: 0 }, 2, { 0: (d) => d })).toThrow(/No migration from v1/);
  });
});
