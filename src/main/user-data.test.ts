import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { userDataDir } from './user-data';

const appData = join('C:', 'Users', 'dev', 'AppData', 'Roaming');

describe('userDataDir', () => {
  it('leaves a packaged build on its default profile, whatever the environment says', () => {
    expect(
      userDataDir({ isPackaged: true, override: join('C:', 'elsewhere'), appData }),
    ).toBeNull();
    expect(userDataDir({ isPackaged: true, override: undefined, appData })).toBeNull();
  });

  it('gives development its own profile, so it never shares data with an installed NestBox', () => {
    expect(userDataDir({ isPackaged: false, override: undefined, appData })).toBe(
      join(appData, 'nestbox-dev'),
    );
    expect(userDataDir({ isPackaged: false, override: '', appData })).toBe(
      join(appData, 'nestbox-dev'),
    );
  });

  it('lets NESTBOX_USER_DATA_DIR choose the profile in development (end-to-end tests)', () => {
    const profile = join('C:', 'e2e', 'profile');
    expect(userDataDir({ isPackaged: false, override: profile, appData })).toBe(profile);
  });
});
