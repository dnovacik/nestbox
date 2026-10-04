import { describe, expect, it } from 'vitest';
import { type MockRoute, RouteSchema } from '@shared/tools/mock/contract';
import { matchPath, matchRoute } from './paths';

const route = (
  id: string,
  method: string,
  path: string,
  patch: Partial<MockRoute> = {},
): MockRoute => ({ ...RouteSchema.parse({ id, method, path }), ...patch });

describe('matchPath', () => {
  it('matches literals and params, ignoring a trailing slash', () => {
    expect(matchPath('/users/:id', '/users/42')).toEqual({ id: '42' });
    expect(matchPath('/users/:id', '/users/42/')).toEqual({ id: '42' });
    expect(matchPath('/users', '/users')).toEqual({});
    expect(matchPath('/', '/')).toEqual({});
  });

  it('needs every segment, and is case-sensitive', () => {
    expect(matchPath('/users/:id', '/users')).toBeNull();
    expect(matchPath('/users/:id', '/users/1/posts')).toBeNull();
    expect(matchPath('/Users', '/users')).toBeNull();
  });

  it('lets a final * take the rest, even nothing', () => {
    expect(matchPath('/files/*', '/files/a/b.txt')).toEqual({});
    expect(matchPath('/files/*', '/files')).toEqual({});
    expect(matchPath('/*', '/anything/at/all')).toEqual({});
  });

  it('decodes each segment, and refuses broken encoding', () => {
    expect(matchPath('/users/:name', '/users/J%C3%BAlia%2Fx')).toEqual({ name: 'Júlia/x' });
    expect(matchPath('/users/:name', '/users/%E0%A4%A')).toBeNull();
  });
});

describe('matchRoute', () => {
  const routes = [
    route('off', 'GET', '/users/me', { enabled: false }),
    route('me', 'GET', '/users/me'),
    route('one', 'GET', '/users/:id'),
    route('any', 'ANY', '/health'),
    route('post', 'POST', '/users'),
  ];

  it('takes the first enabled match', () => {
    expect(matchRoute(routes, 'GET', '/users/me')?.route.id).toBe('me');
    expect(matchRoute(routes, 'GET', '/users/7')).toMatchObject({
      route: { id: 'one' },
      params: { id: '7' },
    });
  });

  it('lets HEAD use GET routes and ANY take every method', () => {
    expect(matchRoute(routes, 'HEAD', '/users/7')?.route.id).toBe('one');
    expect(matchRoute(routes, 'DELETE', '/health')?.route.id).toBe('any');
  });

  it('returns null when nothing matches', () => {
    expect(matchRoute(routes, 'PUT', '/users')).toBeNull();
    expect(matchRoute(routes, 'GET', '/nope')).toBeNull();
  });
});
