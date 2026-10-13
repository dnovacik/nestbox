import { describe, expect, it } from 'vitest';
import { nodePorts } from './ports';

describe('nodePorts', () => {
  it.each([
    ['vite --port 3001', 3001],
    ['vite --port=3001', 3001],
    ['next dev -p 4000', 4000],
    ['next dev --port 4000 --turbo', 4000],
    ['PORT=8080 node server.js', 8080],
    ['cross-env PORT=8080 tsx watch src/index.ts', 8080],
    ['astro dev --host --port 4322', 4322],
  ])('reads %j', (script, port) => {
    expect(nodePorts({ dev: script }, null)).toEqual([port]);
  });

  it('reads dev, then start; explicit ports before the framework default, without duplicates', () => {
    expect(
      nodePorts(
        { dev: 'vite --port 3001', start: 'vite preview --port 4173' },
        { id: 'vite', major: 6 },
      ),
    ).toEqual([3001, 4173, 5173]);
    expect(nodePorts({ dev: 'next dev -p 3000' }, { id: 'next', major: 15 })).toEqual([3000]);
    // Other scripts don't count: a test runner's port isn't where the app listens.
    expect(nodePorts({ test: 'vitest --port 9999' }, null)).toEqual([]);
  });

  it.each([
    ['next', 3000],
    ['nuxt', 3000],
    ['astro', 4321],
    ['sveltekit', 5173],
    ['remix', 5173],
    ['vite', 5173],
    ['nestjs', 3000],
  ] as const)("falls back to %s's default port %s", (id, port) => {
    expect(nodePorts({}, { id, major: null })).toEqual([port]);
  });

  it('has none for frameworks without a fixed port, and ignores out-of-range or unrelated numbers', () => {
    expect(nodePorts({ dev: 'electron .' }, { id: 'electron', major: 33 })).toEqual([]);
    expect(nodePorts({ dev: 'node server.js' }, { id: 'express', major: 4 })).toEqual([]);
    expect(
      nodePorts({ dev: 'vite --port 70000', start: 'node --max-old-space-size=4096 x.js' }, null),
    ).toEqual([]);
    expect(nodePorts({ dev: 'tsc -p tsconfig.json' }, null)).toEqual([]);
  });
});
