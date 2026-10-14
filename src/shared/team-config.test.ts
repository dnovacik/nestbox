import { describe, expect, it } from 'vitest';
import { ProjectSchema } from './types';
import {
  EMPTY_CONTENT,
  itemKey,
  PackagePathSchema,
  splitKey,
  TeamContentSchema,
  TeamItemInputSchema,
} from './team-config';

describe('team config schemas', () => {
  it('gives every project a default team-config state, so the store stays at v2', () => {
    const p = ProjectSchema.parse({ id: 'p1', name: 'shop', path: 'C:\\shop' });
    expect(p.teamConfig).toEqual({ acceptedHash: null, ignored: false, hidden: {} });
  });

  it('accepts package paths as relPaths only', () => {
    for (const ok of ['', 'packages/api', 'apps/web-2'])
      expect(PackagePathSchema.safeParse(ok).success).toBe(true);
    for (const bad of ['/abs', '../up', 'a/../b', 'a#b', 'C:\\x', 'a\\b'])
      expect(PackagePathSchema.safeParse(bad).success).toBe(false);
  });

  it('keys items as package#rest, splitting at the first #', () => {
    expect(itemKey('packages/api', 'route#1')).toBe('packages/api#route#1');
    expect(splitKey('packages/api#route#1')).toEqual({ pkg: 'packages/api', rest: 'route#1' });
    expect(splitKey('Full stack')).toEqual({ pkg: '', rest: 'Full stack' });
  });

  it('has an empty canonical content and validates a section', () => {
    expect(TeamContentSchema.parse(EMPTY_CONTENT)).toEqual(EMPTY_CONTENT);
    expect(
      TeamItemInputSchema.safeParse({ projectId: 'p1', section: 'commands', key: '#dev' }).success,
    ).toBe(true);
    expect(
      TeamItemInputSchema.safeParse({ projectId: 'p1', section: 'nope', key: 'x' }).success,
    ).toBe(false);
  });
});
