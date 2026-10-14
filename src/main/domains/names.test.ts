import { describe, expect, it } from 'vitest';
import { assignNames, packageLabel, toLabel } from './names';

describe('toLabel', () => {
  it('makes a host label from a display name', () => {
    expect(toLabel('My Shop!')).toBe('my-shop');
    expect(toLabel('  --Ünïcode__App--  ')).toBe('n-code-app');
    expect(toLabel('???')).toBe('project');
    expect(toLabel('a'.repeat(80))).toHaveLength(63);
  });
});

describe('packageLabel', () => {
  it('drops an npm scope, else uses the folder', () => {
    expect(packageLabel('@shop/api', 'packages/api')).toBe('api');
    expect(packageLabel('Shop.Core', 'src/Shop.Core')).toBe('shop-core');
    expect(packageLabel('', 'apps/web')).toBe('web');
  });
});

describe('assignNames', () => {
  const shop = {
    id: 'r1',
    name: 'Shop',
    workspaces: [{ id: 'r1::packages/api', name: '@shop/api', relPath: 'packages/api' }],
  };

  it('names roots and workspace packages under them', () => {
    const { names, clashes } = assignNames([shop], {});
    expect(Object.fromEntries(names)).toEqual({
      r1: 'shop.localhost',
      'r1::packages/api': 'api.shop.localhost',
    });
    expect(clashes).toEqual([]);
  });

  it('applies overrides, and numbers clashes in sidebar order', () => {
    const other = { id: 'r2', name: 'shop', workspaces: [] };
    const { names, clashes } = assignNames([shop, other], { 'r1::packages/api': 'backend' });
    expect(names.get('r1::packages/api')).toBe('backend.shop.localhost');
    expect(names.get('r2')).toBe('shop-2.localhost');
    expect(clashes).toEqual(['r2']);
  });
});
