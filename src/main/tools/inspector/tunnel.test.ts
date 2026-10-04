import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryLogger } from '../../logger';
import { fakePlatform } from '../../processes/fake-child';
import { createTunnel, parseTunnelUrl, type Tunnel } from './tunnel';

const BANNER = `2026-10-04T12:00:00Z INF Thank you for trying Cloudflare Tunnel.
2026-10-04T12:00:00Z INF +--------------------------------------------------------------------------------------------+
2026-10-04T12:00:00Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
2026-10-04T12:00:00Z INF |  https://gentle-river-moon-4321.trycloudflare.com                                          |
2026-10-04T12:00:00Z INF +--------------------------------------------------------------------------------------------+
`;

describe('parseTunnelUrl', () => {
  it('finds the quick tunnel address in the banner', () => {
    expect(parseTunnelUrl(BANNER)).toBe('https://gentle-river-moon-4321.trycloudflare.com');
  });

  it('ignores other https addresses and partial names', () => {
    expect(
      parseTunnelUrl('see https://developers.cloudflare.com/cloudflare-one/ for docs'),
    ).toBeNull();
    expect(parseTunnelUrl('https://api.trycloudflare.com/tunnel request failed')).toBeNull();
    expect(parseTunnelUrl('https://abc')).toBeNull();
  });
});

let tunnel: Tunnel | null = null;
afterEach(async () => {
  await tunnel?.stop();
  tunnel = null;
});

function setup(timeoutMs = 30_000) {
  const platform = fakePlatform();
  const logger = createMemoryLogger();
  const onChange = vi.fn();
  tunnel = createTunnel({ platform, logger, cwd: '/work/shop', port: 4020, onChange, timeoutMs });
  const spawned = () =>
    (
      vi.mocked(platform.spawnCommand).mock.calls as unknown as [
        { command: string; args: string[] },
      ][]
    )[0]?.[0];
  return { tunnel, platform, logger, onChange, spawned };
}

describe('createTunnel', () => {
  it('starts cloudflared for the inspector port and turns on when the address appears', async () => {
    const { tunnel, platform, onChange, spawned, logger } = setup();
    tunnel.start();
    expect(tunnel.view()).toEqual({ state: 'starting', url: null, error: null });
    await vi.waitFor(() => expect(platform.children).toHaveLength(1));
    expect(spawned()).toMatchObject({
      command: 'cloudflared',
      args: [
        'tunnel',
        '--url',
        'http://localhost:4020',
        '--http-host-header',
        'localhost:4020',
        '--no-autoupdate',
      ],
    });
    // The address can arrive split across chunks, on stderr.
    platform.last().stderr.write(BANNER.slice(0, 300));
    platform.last().stderr.write(BANNER.slice(300));
    await vi.waitFor(() =>
      expect(tunnel.view()).toEqual({
        state: 'on',
        url: 'https://gentle-river-moon-4321.trycloudflare.com',
        error: null,
      }),
    );
    expect(onChange).toHaveBeenCalled();
    expect(JSON.stringify(logger.entries)).not.toMatch(/trycloudflare|gentle/);
  });

  it('kills cloudflared when no address comes in time', async () => {
    const { tunnel, platform } = setup(50);
    tunnel.start();
    await vi.waitFor(() =>
      expect(tunnel.view()).toEqual({
        state: 'error',
        url: null,
        error: 'No tunnel address within 30 s',
      }),
    );
    expect(platform.killTree).toHaveBeenCalled();
  });

  it('reports cloudflared stopping by itself', async () => {
    const { tunnel, platform } = setup();
    tunnel.start();
    await vi.waitFor(() => expect(platform.children).toHaveLength(1));
    platform.last().stderr.write(BANNER);
    await vi.waitFor(() => expect(tunnel.view().state).toBe('on'));
    platform.last().exit(1);
    await vi.waitFor(() =>
      expect(tunnel.view()).toEqual({
        state: 'error',
        url: null,
        error: 'cloudflared stopped (exit 1)',
      }),
    );
  });

  it('says when cloudflared cannot start', async () => {
    const { tunnel, platform } = setup();
    platform.failNextSpawn();
    tunnel.start();
    await vi.waitFor(() =>
      expect(tunnel.view()).toEqual({
        state: 'error',
        url: null,
        error: 'cloudflared could not be started',
      }),
    );
  });

  it('stops on demand and goes back to off', async () => {
    const { tunnel, platform } = setup();
    tunnel.start();
    await vi.waitFor(() => expect(platform.children).toHaveLength(1));
    platform.last().stderr.write(BANNER);
    await vi.waitFor(() => expect(tunnel.view().state).toBe('on'));
    await tunnel.stop();
    expect(platform.killTree).toHaveBeenCalled();
    expect(tunnel.view()).toEqual({ state: 'off', url: null, error: null });
  });
});
