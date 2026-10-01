import type { Logger } from '../logger';

export const SHUTDOWN_TIMEOUT_MS = 5_000;

export interface QuitControllerDeps {
  liveCount(): number;
  /** Resolves true for "Stop and quit". */
  confirmQuit(liveCount: number): Promise<boolean>;
  /** Stops processes and disposes tools; the controller applies the timeout. */
  shutdown(): Promise<void>;
  /** app.quit() */
  quit(): void;
  closeToTray(): boolean;
  hideWindow(): void;
  logger: Logger;
  timeoutMs?: number;
}

interface Preventable {
  preventDefault(): void;
}

export interface QuitController {
  /** app 'before-quit' */
  onBeforeQuit(event: Preventable): void;
  /** BrowserWindow 'close' */
  onWindowClose(event: Preventable): void;
  /** BrowserWindow 'session-end' (Windows logoff or shutdown): no confirmation. */
  onSessionEnd(): void;
  /** Resolves true when the app is quitting, false when the user cancelled or a quit is already in progress. */
  requestQuit(opts?: { confirm?: boolean }): Promise<boolean>;
}

/**
 * Every way out of the app goes through here: closing the window (hide to tray or quit), tray Quit,
 * Ctrl+Q and the OS quitting the app. Running scripts are confirmed once, then stopped with a timeout,
 * and only then does Electron get to quit.
 */
export function createQuitController(deps: QuitControllerDeps): QuitController {
  const timeoutMs = deps.timeoutMs ?? SHUTDOWN_TIMEOUT_MS;
  let allowed = false;
  let inProgress = false;

  async function shutdownWithTimeout(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    const outcome = await Promise.race([
      deps.shutdown().then(
        () => 'done' as const,
        () => 'failed' as const,
      ),
      timedOut,
    ]);
    clearTimeout(timer);
    if (outcome === 'timeout') deps.logger.warn('shutdown timed out', { ms: timeoutMs });
    if (outcome === 'failed') deps.logger.error('shutdown failed');
  }

  async function requestQuit({ confirm = true } = {}): Promise<boolean> {
    if (allowed) {
      deps.quit();
      return true;
    }
    if (inProgress) return false;
    inProgress = true;
    try {
      const live = deps.liveCount();
      if (confirm && live > 0 && !(await deps.confirmQuit(live))) return false;
      await shutdownWithTimeout();
      allowed = true;
      deps.quit();
      return true;
    } finally {
      inProgress = false;
    }
  }

  return {
    onBeforeQuit(event) {
      if (allowed) return;
      event.preventDefault();
      void requestQuit();
    },
    onWindowClose(event) {
      if (allowed) return;
      event.preventDefault();
      if (deps.closeToTray()) deps.hideWindow();
      else void requestQuit();
    },
    onSessionEnd() {
      void requestQuit({ confirm: false });
    },
    requestQuit,
  };
}
