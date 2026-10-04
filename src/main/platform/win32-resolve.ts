// Finds a command on PATH the way cmd.exe would, minus the current folder. cmd.exe looks in the current
// folder first, and NestBox runs commands with cwd = the user's project: a claude.cmd or docker.bat in a
// cloned repository must never run just because NestBox started "claude" or "docker".
import { statSync } from 'node:fs';
import { win32 } from 'node:path';

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

function defaultIsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * The absolute path of `command` from the PATH and PATHEXT in env; null when it isn't there. A command that
 * already is a path is returned as is. Relative PATH entries (".", "bin") are skipped: they would resolve
 * against the project folder.
 */
export function resolveOnPath(
  command: string,
  env: NodeJS.ProcessEnv,
  isFile: (path: string) => boolean = defaultIsFile,
): string | null {
  if (/[\\/]/.test(command)) return command;
  const exts = (envValue(env, 'PATHEXT') ?? DEFAULT_PATHEXT)
    .split(';')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.startsWith('.'));
  const hasExt = exts.some((e) => command.toLowerCase().endsWith(e));
  const candidates = hasExt
    ? [command, ...exts.map((e) => command + e)]
    : exts.map((e) => command + e);
  for (const raw of (envValue(env, 'PATH') ?? '').split(';')) {
    const dir = raw.trim().replace(/^"(.*)"$/, '$1');
    if (dir === '' || !win32.isAbsolute(dir) || /^[\\/][^\\/]/.test(dir)) continue;
    for (const name of candidates) {
      const full = win32.join(dir, name);
      if (isFile(full)) return full;
    }
  }
  return null;
}
