import { describe, expect, it } from 'vitest';
import { createSharedContext } from './shared-context';

describe('shared context', () => {
  it('stores facts per project', () => {
    const ctx = createSharedContext();
    ctx.forProject('a').publish('PORT', 3000);
    expect(ctx.forProject('a').get('PORT')).toBe(3000);
    expect(ctx.forProject('b').get('PORT')).toBeUndefined();
  });

  it('clears a project', () => {
    const ctx = createSharedContext();
    ctx.forProject('a').publish('PORT', 3000);
    ctx.clearProject('a');
    expect(ctx.forProject('a').get('PORT')).toBeUndefined();
  });
});
