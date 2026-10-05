import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { brandAsset } from './assets';

describe('brandAsset', () => {
  it('resolves from the app root in dev', () => {
    expect(brandAsset({ isPackaged: false, appPath: '/repo', resourcesPath: '/ignored' }, 'png/nestbox.ico')).toBe(
      join('/repo', 'resources', 'brand', 'png', 'nestbox.ico'),
    );
  });

  it('resolves from resourcesPath when packaged (extraResources → brand/)', () => {
    expect(brandAsset({ isPackaged: true, appPath: '/ignored', resourcesPath: '/app/resources' }, 'png/nestbox.ico')).toBe(
      join('/app/resources', 'brand', 'png', 'nestbox.ico'),
    );
  });
});

describe('nestbox.ico', () => {
  it('keeps every size under 256 px as a bitmap (Windows draws PNG-compressed small icons unreliably)', () => {
    const ico = readFileSync(join(__dirname, '..', '..', 'resources', 'brand', 'png', 'nestbox.ico'));
    const count = ico.readUInt16LE(4);
    const sizes: number[] = [];
    for (let i = 0; i < count; i++) {
      const entry = 6 + 16 * i;
      const size = ico[entry] === 0 ? 256 : (ico[entry] ?? 0);
      const offset = ico.readUInt32LE(entry + 12);
      const png = ico.subarray(offset, offset + 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      expect(png, `${size} px`).toBe(size === 256);
      sizes.push(size);
    }
    expect(sizes).toEqual(expect.arrayContaining([16, 24, 32, 48, 256]));
  });
});
