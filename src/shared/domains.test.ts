import { describe, expect, it } from 'vitest';
import { AppSettingsSchema } from './types';
import { DomainsPortsInputSchema, DomainsNameInputSchema, LABEL } from './domains';

describe('domains settings', () => {
  it('defaults to off on 80/443 with nothing trusted, so old stores need no migration', () => {
    expect(AppSettingsSchema.parse({}).domains).toEqual({
      enabled: false,
      httpPort: 80,
      httpsPort: 443,
      names: {},
      rewriteHost: {},
      trust: 'none',
    });
  });

  it('refuses equal or out-of-range ports', () => {
    expect(DomainsPortsInputSchema.safeParse({ httpPort: 80, httpsPort: 80 }).success).toBe(false);
    expect(DomainsPortsInputSchema.safeParse({ httpPort: 0, httpsPort: 443 }).success).toBe(false);
    expect(DomainsPortsInputSchema.safeParse({ httpPort: 18080, httpsPort: 18443 }).success).toBe(
      true,
    );
  });

  it('accepts host labels only as name overrides', () => {
    expect(LABEL.test('shop')).toBe(true);
    expect(LABEL.test('my-shop-2')).toBe(true);
    expect(LABEL.test('-shop')).toBe(false);
    expect(LABEL.test('Shop')).toBe(false);
    expect(DomainsNameInputSchema.safeParse({ projectId: 'p1', label: 'a.b' }).success).toBe(false);
    expect(DomainsNameInputSchema.safeParse({ projectId: 'p1', label: null }).success).toBe(true);
  });
});
