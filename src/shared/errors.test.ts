import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { describeIssues, fail, NestboxError, ok } from './errors';

describe('errors', () => {
  it('NestboxError carries a code and is an Error', () => {
    const e = new NestboxError('CONFLICT', 'already added');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('CONFLICT');
    expect(e.name).toBe('NestboxError');
  });

  it('builds envelopes', () => {
    expect(ok(1)).toEqual({ ok: true, data: 1 });
    expect(fail('NOT_FOUND', 'nope')).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'nope' } });
  });

  it('describeIssues names paths and codes but never the received values', () => {
    const r = z.object({ name: z.string(), pinned: z.boolean() }).safeParse({ name: 5, pinned: 'SECRET_VALUE' });
    expect(r.success).toBe(false);
    if (r.success) return;
    const text = describeIssues(r.error);
    expect(text).toContain('name');
    expect(text).toContain('pinned');
    expect(text).not.toContain('SECRET_VALUE');
  });
});
