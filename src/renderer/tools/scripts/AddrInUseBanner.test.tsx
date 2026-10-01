import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { PortRow } from '@shared/ports';
import { installMockBridge, type MockHandlers } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { AddrInUseBanner } from './AddrInUseBanner';

const foreign: PortRow = { port: 3000, pid: 77, addresses: ['::'], processName: 'node.exe', command: null, owner: null };

function setup(rows: PortRow[], over: MockHandlers = {}) {
  const bridge = installMockBridge({
    'ports:list': () => ({ rows, scannedAt: 1, stale: false }),
    'ports:kill': ({ confirmed }) => (confirmed ? { result: 'killed', processName: 'node.exe' } : { result: 'needs-confirm', processName: 'node.exe' }),
    'ports:waitFree': () => true,
    'tools:invoke': () => ({}) as never,
    ...over,
  });
  renderWithProviders(<AddrInUseBanner projectId="p1" script="dev" port={3000} />);
  return bridge;
}

describe('AddrInUseBanner', () => {
  it('names the process on the port and kills it (after the confirm), waits, then restarts', async () => {
    const bridge = setup([foreign]);
    const banner = await screen.findByRole('alert');
    expect(await within(banner).findByText('Port 3000 is in use by node.exe (PID 77).')).toBeInTheDocument();
    await userEvent.click(within(banner).getByRole('button', { name: 'Kill and restart' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Kill' }));
    await waitFor(() => expect(bridge.callsTo('tools:invoke')).toEqual([{ toolId: 'scripts', projectId: 'p1', method: 'restart', input: { script: 'dev' } }]));
    expect(bridge.callsTo('ports:kill')).toEqual([
      { pid: 77, port: 3000, confirmed: false },
      { pid: 77, port: 3000, confirmed: true },
    ]);
    expect(bridge.callsTo('ports:waitFree')).toEqual([{ port: 3000, timeoutMs: 5_000 }]);
  });

  it('offers a plain restart when the port is free now', async () => {
    const bridge = setup([]);
    const banner = await screen.findByRole('alert');
    expect(await within(banner).findByText('Port 3000 was in use. It is free now.')).toBeInTheDocument();
    await userEvent.click(within(banner).getByRole('button', { name: 'Restart' }));
    await waitFor(() => expect(bridge.callsTo('tools:invoke')).toHaveLength(1));
    expect(bridge.callsTo('ports:kill')).toEqual([]);
  });

  it('does not restart when the port stays busy', async () => {
    const bridge = setup([foreign], { 'ports:waitFree': () => false });
    await userEvent.click(await screen.findByRole('button', { name: 'Kill and restart' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Kill' }));
    expect(await screen.findByText('Port 3000 is still in use')).toBeInTheDocument();
    expect(bridge.callsTo('tools:invoke')).toEqual([]);
  });
});
