import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { InspectorStatus } from '@shared/tools/inspector/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { inspectorStatus } from './fixtures';
import { TunnelBar } from './TunnelBar';

type Call = { method: string; input: unknown };

function setup(status: InspectorStatus) {
  const calls: Call[] = [];
  const bridge = installMockBridge({
    'tools:invoke': (({ method, input }: Call) => {
      calls.push({ method, input });
      return method === 'tunnelStart' ? { state: 'starting', url: null, error: null } : undefined;
    }) as never,
    'app:openExternal': () => undefined,
  });
  renderWithProviders(<TunnelBar projectId="p1" status={status} />);
  return { bridge, of: (m: string) => calls.filter((c) => c.method === m) };
}

const running = (patch: Partial<InspectorStatus> = {}) =>
  inspectorStatus({ running: true, port: 4020, url: 'http://localhost:4020', ...patch });

describe('TunnelBar', () => {
  it('needs the inspector to run', () => {
    setup(inspectorStatus());
    expect(screen.getByRole('button', { name: 'Share publicly' })).toBeDisabled();
  });

  it('asks before sharing, then starts the tunnel', async () => {
    const { of } = setup(running());
    await userEvent.click(screen.getByRole('button', { name: 'Share publicly' }));
    expect(
      await screen.findByText(/Anyone with the address can reach your API/),
    ).toBeInTheDocument();
    expect(of('tunnelStart')).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(of('tunnelStart')).toHaveLength(1);
  });

  it('shows the address with Copy and Stop sharing while on', async () => {
    const { of } = setup(
      running({ tunnel: { state: 'on', url: 'https://a-b-c.trycloudflare.com', error: null } }),
    );
    expect(screen.getByText('https://a-b-c.trycloudflare.com')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await userEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    expect(of('copyTunnelUrl')).toHaveLength(1);
    expect(of('tunnelStop')).toHaveLength(1);
  });

  it('shows starting and errors', () => {
    setup(
      running({ tunnel: { state: 'error', url: null, error: 'No tunnel address within 30 s' } }),
    );
    expect(screen.getByText('No tunnel address within 30 s')).toHaveClass('text-err');
  });

  it('points to the install page when cloudflared is missing', async () => {
    const { bridge } = setup(running({ cloudflared: false }));
    expect(screen.queryByRole('button', { name: 'Share publicly' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'How to install' }));
    expect(bridge.callsTo('app:openExternal')).toEqual([
      { url: expect.stringContaining('developers.cloudflare.com') },
    ]);
  });
});
