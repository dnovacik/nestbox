import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PortRow } from '@shared/ports';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { portsForProject, usePorts } from './ports';

const row = (port: number, owner: PortRow['owner'] = null): PortRow => ({
  port,
  pid: port,
  addresses: ['0.0.0.0'],
  processName: 'node.exe',
  command: null,
  owner,
});

describe('portsForProject', () => {
  it('keeps the rows owned by the project or its workspace packages', () => {
    const rows = [
      row(3000, { projectId: 'shop', script: 'dev' }),
      row(3001, { projectId: 'shop::packages/api', script: 'dev' }),
      row(3002, { projectId: 'shopping', script: 'dev' }),
      row(5432),
    ];
    expect(portsForProject(rows, 'shop').map((r) => r.port)).toEqual([3000, 3001]);
  });
});

function Probe() {
  const { data } = usePorts();
  return <p>{data ? `ports ${data.rows.map((r) => r.port).join(',')}` : 'loading'}</p>;
}

describe('usePorts', () => {
  it('loads the port list', async () => {
    const bridge = installMockBridge({ 'ports:list': () => ({ rows: [row(3000)], scannedAt: 1, stale: false }) });
    renderWithProviders(<Probe />);
    expect(await screen.findByText('ports 3000')).toBeInTheDocument();
    await waitFor(() => expect(bridge.callsTo('ports:list')).toHaveLength(1));
  });
});
