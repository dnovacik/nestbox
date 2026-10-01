import { describe, expect, it } from 'vitest';
import { createMemoryLogger } from './logger';

describe('memory logger', () => {
  it('records level, message and primitive fields', () => {
    const log = createMemoryLogger();
    log.warn('store reset', { reason: 'invalid', backup: null });
    expect(log.entries).toEqual([{ level: 'warn', message: 'store reset', fields: { reason: 'invalid', backup: null } }]);
  });
});
