// Which profile folder (userData) NestBox uses. A packaged build keeps Electron's default. A development
// build (pnpm dev) gets its own folder, so it never shares projects, settings, the PID ledger or the local
// CA with an installed NestBox; NESTBOX_USER_DATA_DIR picks another one (end-to-end tests).
import { join } from 'node:path';

const DEV_PROFILE = 'nestbox-dev';

/** The folder to use instead of Electron's default; null to keep the default. */
export function userDataDir(opts: {
  isPackaged: boolean;
  override: string | undefined;
  appData: string;
}): string | null {
  if (opts.isPackaged) return null;
  return opts.override ? opts.override : join(opts.appData, DEV_PROFILE);
}
