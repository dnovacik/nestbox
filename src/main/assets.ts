import { join } from 'node:path';

export interface AssetEnv {
  isPackaged: boolean;
  /** app.getAppPath() — the repo root in dev. */
  appPath: string;
  /** process.resourcesPath — where extraResources land when packaged. */
  resourcesPath: string;
}

/** Single resolver for files under resources/brand (packaged as extraResources → brand/). */
export function brandAsset(env: AssetEnv, relPath: string): string {
  const base = env.isPackaged ? join(env.resourcesPath, 'brand') : join(env.appPath, 'resources', 'brand');
  return join(base, ...relPath.split('/'));
}
