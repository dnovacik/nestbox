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
