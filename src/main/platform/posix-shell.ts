// The user's login-shell environment and PATH lookup, for macOS. Apps started from Finder or the Dock get
// a minimal PATH (no Homebrew, nvm or pnpm), so scripts and commands run with the env a terminal would give.
// Env values are never logged: only failure codes are.
import { constants } from 'node:fs';
import { access as fsAccess } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { delimiter, isAbsolute, join } from 'node:path';
import type { Logger } from '../logger';
import type { CommandRunner } from './adapter';

const SHELL_TIMEOUT_MS = 10_000;
/** Re-read after this long, so a tool installed while NestBox runs is found without a restart. */
const SHELL_ENV_TTL_MS = 5 * 60_000;
const MAX_ENV_BYTES = 1024 * 1024;

/**
 * The `env -0` output between a start and an end marker (shell profiles may print banners around it); null
 * without both. Two different markers, because shells set `$_` to the last argument of the previous command,
 * so the env itself contains the start marker.
 */
export function parseMarkedEnv(stdout: string, startMarker: string, endMarker: string): NodeJS.ProcessEnv | null {
  const at = stdout.indexOf(startMarker);
  const start = at === -1 ? -1 : at + startMarker.length;
  const end = start === -1 ? -1 : stdout.indexOf(endMarker, start);
  if (end === -1) return null;
  const env: NodeJS.ProcessEnv = {};
  for (const pair of stdout.slice(start, end).split('\0')) {
    const eq = pair.indexOf('=');
    if (eq > 0) env[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return env;
}

export interface ShellEnv {
  /** The login shell's environment, cached for 5 minutes (concurrent calls share one run). */
  get(): Promise<NodeJS.ProcessEnv>;
  /** Forget the cached result, so the next get() runs the shell again. */
  clear(): void;
}

export interface ShellEnvDeps {
  runner: CommandRunner;
  /** $SHELL, or /bin/zsh. */
  shell: string;
  /** Used when the shell fails: the app's own environment. */
  fallback: NodeJS.ProcessEnv;
  logger: Logger;
  now?: () => number;
}

export function createShellEnv({ runner, shell, fallback, logger, now = Date.now }: ShellEnvDeps): ShellEnv {
  let cached: { at: number; env: Promise<NodeJS.ProcessEnv> } | null = null;

  async function resolve(): Promise<NodeJS.ProcessEnv> {
    const id = randomUUID().replace(/-/g, '');
    const [startMarker, endMarker] = [`__NESTBOX_ENV_${id}_START__`, `__NESTBOX_ENV_${id}_END__`];
    // -i and -l load the same profile files a terminal does. Works in zsh, bash and fish alike.
    const script = `printf '%s' ${startMarker}; env -0; printf '%s' ${endMarker}`;
    try {
      const { code, stdout } = await runner.exec(shell, ['-ilc', script], { timeoutMs: SHELL_TIMEOUT_MS, maxBytes: MAX_ENV_BYTES });
      const env = code === 0 ? parseMarkedEnv(stdout, startMarker, endMarker) : null;
      if (env) return env;
      logger.warn('shell env unavailable', { code });
    } catch (error) {
      logger.warn('shell env unavailable', { code: String((error as { code?: unknown }).code ?? 'error') });
    }
    return { ...fallback };
  }

  return {
    get() {
      const t = now();
      if (!cached || t - cached.at >= SHELL_ENV_TTL_MS) cached = { at: t, env: resolve() };
      return cached.env;
    },
    clear() {
      cached = null;
    },
  };
}

/**
 * The executable a command resolves to on PATH, like `command -v`, without a subprocess; null when none.
 * A command containing a slash is a path: absolute is checked as is, relative is refused.
 */
export async function findOnPath(
  command: string,
  path: string,
  access: (path: string, mode: number) => Promise<void> = fsAccess,
): Promise<string | null> {
  const executable = async (candidate: string) => {
    try {
      await access(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (command.includes('/')) return isAbsolute(command) && (await executable(command)) ? command : null;
  for (const dir of path.split(delimiter)) {
    if (dir === '') continue;
    const candidate = join(dir, command);
    if (await executable(candidate)) return candidate;
  }
  return null;
}
