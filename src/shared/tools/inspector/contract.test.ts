import { describe, expect, it } from 'vitest';
import { LocalUrlSchema, PackageInspectorSchema, SendInputSchema } from './contract';

describe('LocalUrlSchema', () => {
  it.each([
    'http://localhost:3000',
    'http://127.0.0.1:8080/api',
    'https://localhost',
    'http://[::1]:3000/',
  ])('accepts %s', (url) => {
    expect(LocalUrlSchema.safeParse(url).success).toBe(true);
  });

  it.each([
    'http://example.com',
    'http://192.168.1.2:3000',
    'ftp://localhost',
    'http://u:p@localhost:3000',
    'http://localhost:3000/?x=1',
    'http://localhost/#a',
    'localhost:3000',
  ])('refuses %s', (url) => {
    expect(LocalUrlSchema.safeParse(url).success).toBe(false);
  });
});

describe('PackageInspectorSchema', () => {
  it('defaults to an automatic port and the PORT from .env', () => {
    expect(PackageInspectorSchema.parse({})).toEqual({ port: null, target: null });
  });
});

describe('SendInputSchema', () => {
  const base = {
    from: 'e1',
    method: 'POST',
    path: '/users?x=1',
    headers: [
      { name: 'Authorization', keep: true },
      { name: 'X-A', value: '1' },
    ],
    body: '{}',
  };

  it('accepts kept and edited headers', () => {
    expect(SendInputSchema.safeParse(base).success).toBe(true);
  });

  it('refuses header injection, odd methods and paths', () => {
    expect(
      SendInputSchema.safeParse({ ...base, headers: [{ name: 'X-A', value: 'a\r\nB: c' }] })
        .success,
    ).toBe(false);
    expect(SendInputSchema.safeParse({ ...base, method: 'get' }).success).toBe(false);
    expect(SendInputSchema.safeParse({ ...base, path: 'users' }).success).toBe(false);
    expect(SendInputSchema.safeParse({ ...base, path: '/a b' }).success).toBe(false);
  });
});
