// The inspector's public address: a Cloudflare quick tunnel (cloudflared, no account) to the inspector port.
// The address is a capability (whoever has it reaches the API), so it is never logged, and neither is
// cloudflared's output.
import type { ChildProcess } from 'node:child_process';
import type { Logger } from '../../logger';
import type { PlatformAdapter } from '../../platform/adapter';

export const TUNNEL_TIMEOUT_MS = 30_000;
const URL_PATTERN = /https:\/\/(?!api\.)[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com\b/;
const SCAN_LIMIT = 64 * 1024;

export function parseTunnelUrl(text: string): string | null {
  return URL_PATTERN.exec(text)?.[0] ?? null;
}

export interface TunnelView {
  state: 'off' | 'starting' | 'on' | 'error';
  url: string | null;
  error: string | null;
}

export interface Tunnel {
  start(): void;
  stop(): Promise<void>;
  view(): TunnelView;
}

export function createTunnel(deps: {
  platform: Pick<PlatformAdapter, 'spawnCommand' | 'killTree' | 'resolveShellEnv'>;
  logger: Logger;
  cwd: string;
  port: number;
  onChange(): void;
  timeoutMs?: number;
}): Tunnel {
  let view: TunnelView = { state: 'off', url: null, error: null };
  let child: ChildProcess | null = null;
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const set = (next: TunnelView) => {
    view = next;
    deps.onChange();
  };

  const kill = async (c: ChildProcess | null) => {
    if (c?.pid !== undefined) await deps.platform.killTree(c.pid).catch(() => undefined);
  };

  async function launch(): Promise<void> {
    const env = await deps.platform.resolveShellEnv();
    if (stopping || view.state !== 'starting') return;
    const target = `localhost:${deps.port}`;
    const c = deps.platform.spawnCommand({
      cwd: deps.cwd,
      command: 'cloudflared',
      // --http-host-header: the inspector only answers local Host names (DNS rebinding).
      args: [
        'tunnel',
        '--url',
        `http://${target}`,
        '--http-host-header',
        target,
        '--no-autoupdate',
      ],
      env,
    });
    child = c;
    let seen = '';
    const scan = (chunk: Buffer) => {
      if (view.state !== 'starting' || seen.length > SCAN_LIMIT) return;
      seen += chunk.toString('utf8');
      const url = parseTunnelUrl(seen);
      if (!url) return;
      if (timer) clearTimeout(timer);
      deps.logger.info('tunnel on', { port: deps.port });
      set({ state: 'on', url, error: null });
    };
    c.stdout?.on('data', scan);
    c.stderr?.on('data', scan);
    let failedToStart = false;
    c.once('error', () => {
      failedToStart = true;
    });
    c.once('close', (code: number | null) => {
      if (timer) clearTimeout(timer);
      if (child === c) child = null;
      if (stopping) return;
      deps.logger.warn('tunnel stopped', { port: deps.port, code: code ?? 'none' });
      if (view.state === 'error') return;
      set({
        state: 'error',
        url: null,
        error: failedToStart
          ? 'cloudflared could not be started'
          : `cloudflared stopped (exit ${code ?? 'unknown'})`,
      });
    });
    timer = setTimeout(() => {
      if (view.state !== 'starting') return;
      set({ state: 'error', url: null, error: 'No tunnel address within 30 s' });
      void kill(c);
    }, deps.timeoutMs ?? TUNNEL_TIMEOUT_MS);
  }

  return {
    start() {
      if (view.state === 'starting' || view.state === 'on') return;
      stopping = false;
      set({ state: 'starting', url: null, error: null });
      void launch();
    },
    async stop() {
      stopping = true;
      if (timer) clearTimeout(timer);
      const c = child;
      child = null;
      await kill(c);
      if (view.state !== 'off') {
        deps.logger.info('tunnel off', { port: deps.port });
        set({ state: 'off', url: null, error: null });
      }
    },
    view: () => view,
  };
}
