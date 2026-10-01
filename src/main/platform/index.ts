import type { PlatformAdapter, PlatformDeps } from './adapter';
import { createDarwinAdapter } from './darwin';
import { createWin32Adapter } from './win32';

export type { PlatformAdapter } from './adapter';

export function createPlatformAdapter(deps: PlatformDeps): PlatformAdapter {
  return process.platform === 'win32' ? createWin32Adapter(deps) : createDarwinAdapter(deps);
}
