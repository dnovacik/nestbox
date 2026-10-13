import { describe, expect, it } from 'vitest';
import { detectFramework, frameworkLabel } from './framework';

const pkg = (
  dependencies: Record<string, string>,
  devDependencies: Record<string, string> = {},
) => ({
  dependencies,
  devDependencies,
});

describe('detectFramework', () => {
  it.each([
    [{ next: '^15.0.3' }, 'next', 15],
    [{ nuxt: '^3.13.0' }, 'nuxt', 3],
    [{ '@remix-run/react': '^2.15.0', '@remix-run/node': '^2.15.0' }, 'remix', 2],
    [{ astro: '^4.16.0' }, 'astro', 4],
    [{ '@sveltejs/kit': '^2.8.0' }, 'sveltekit', 2],
    [{ vite: '^6.0.1' }, 'vite', 6],
    [{ '@nestjs/core': '^10.4.0' }, 'nestjs', 10],
    [{ express: '~4.21.1' }, 'express', 4],
    [{ electron: '33.2.0' }, 'electron', 33],
  ])('%o → %s %s', (deps, id, major) => {
    expect(detectFramework(pkg(deps))).toEqual({ id, major });
  });

  it('looks in devDependencies too', () => {
    expect(detectFramework(pkg({}, { vite: '^5.4.0' }))).toEqual({ id: 'vite', major: 5 });
  });

  it('picks the framework over the tools it builds on', () => {
    expect(
      detectFramework(pkg({ next: '^15.0.0', react: '^19.0.0' }, { vite: '^6.0.0' }))?.id,
    ).toBe('next');
    expect(detectFramework(pkg({ '@remix-run/react': '^2.0.0' }, { vite: '^6.0.0' }))?.id).toBe(
      'remix',
    );
    expect(detectFramework(pkg({ '@sveltejs/kit': '^2.0.0' }, { vite: '^6.0.0' }))?.id).toBe(
      'sveltekit',
    );
    expect(detectFramework(pkg({ '@nestjs/core': '^10.0.0', express: '^4.0.0' }))?.id).toBe(
      'nestjs',
    );
    // An Electron app built with Vite is an Electron app.
    expect(detectFramework(pkg({}, { electron: '^33.0.0', vite: '^6.0.0' }))?.id).toBe('electron');
    expect(detectFramework(pkg({ express: '^4.0.0' }, { vite: '^6.0.0' }))?.id).toBe('vite');
  });

  it.each([
    'latest',
    '*',
    'workspace:*',
    'catalog:',
    'npm:next@15',
    'file:../next',
    'github:vercel/next.js',
    '',
  ])('has no major for %j', (range) => {
    expect(detectFramework(pkg({ next: range }))).toEqual({ id: 'next', major: null });
  });

  it('finds nothing without a known framework or dependencies', () => {
    expect(detectFramework(pkg({ react: '^19.0.0', lodash: '^4.17.21' }))).toBeNull();
    expect(detectFramework({ dependencies: 'nope', devDependencies: ['next'] })).toBeNull();
    expect(detectFramework(null)).toBeNull();
  });
});

describe('frameworkLabel', () => {
  it('names the framework with its major', () => {
    expect(frameworkLabel({ id: 'next', major: 15 })).toBe('Next.js 15');
    expect(frameworkLabel({ id: 'sveltekit', major: null })).toBe('SvelteKit');
    expect(frameworkLabel({ id: 'nestjs', major: 10 })).toBe('NestJS 10');
  });
});
