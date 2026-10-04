import { describe, expect, it } from 'vitest';
import { PackageMockSchema, RouteSchema } from './contract';

const route = (patch: Record<string, unknown> = {}) => ({
  id: 'r1',
  method: 'GET',
  path: '/users/:id',
  ...patch,
});

describe('RouteSchema', () => {
  it('fills defaults', () => {
    expect(RouteSchema.parse(route())).toEqual({
      id: 'r1',
      enabled: true,
      method: 'GET',
      path: '/users/:id',
      status: 200,
      contentType: 'json',
      headers: [],
      body: '',
      delayMs: 0,
      fail: { on: false, status: 500 },
    });
  });

  it.each(['/', '/users', '/users/:id/posts', '/files/*', '/*', '/a/'])(
    'accepts the path %s',
    (path) => {
      expect(RouteSchema.safeParse(route({ path })).success).toBe(true);
    },
  );

  it.each(['users', '/a b', '/a?x=1', '/a/*/b', '/a//b', '/a#x'])('refuses the path %s', (path) => {
    expect(RouteSchema.safeParse(route({ path })).success).toBe(false);
  });

  it('refuses bad or reserved headers and line breaks in values', () => {
    expect(
      RouteSchema.safeParse(route({ headers: [{ name: 'X-Ok', value: 'yes' }] })).success,
    ).toBe(true);
    expect(
      RouteSchema.safeParse(route({ headers: [{ name: 'Bad Name', value: 'x' }] })).success,
    ).toBe(false);
    expect(
      RouteSchema.safeParse(route({ headers: [{ name: 'Content-Length', value: '1' }] })).success,
    ).toBe(false);
    expect(
      RouteSchema.safeParse(route({ headers: [{ name: 'X-A', value: 'a\r\nSet-Cookie: x' }] }))
        .success,
    ).toBe(false);
  });

  it('checks a JSON body with placeholders, and lets a text body be anything', () => {
    expect(RouteSchema.safeParse(route({ body: '{"id":"{{params.id}}"}' })).success).toBe(true);
    const bad = RouteSchema.safeParse(route({ body: '{"id":' }));
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path).toEqual(['body']);
    expect(RouteSchema.safeParse(route({ body: '{"id":', contentType: 'text' })).success).toBe(
      true,
    );
  });
});

describe('PackageMockSchema', () => {
  it('defaults to no routes, no delay and no failure', () => {
    expect(PackageMockSchema.parse({})).toEqual({
      port: null,
      routes: [],
      delayMs: 0,
      failAll: { on: false, status: 500 },
    });
  });

  it('caps the routes at 100', () => {
    const routes = Array.from({ length: 101 }, (_, i) => route({ id: `r${i}` }));
    expect(PackageMockSchema.safeParse({ routes }).success).toBe(false);
  });
});
