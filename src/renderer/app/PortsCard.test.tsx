import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PortRow } from '@shared/ports';
import { AppSettingsSchema } from '@shared/types';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { PortsCard } from './PortsCard';

const row = (port: number, pid: number, extra: Partial<PortRow> = {}): PortRow => ({
  port,
  pid,
  addresses: ['0.0.0.0'],
  processName: 'node.exe',
  command: null,
  owner: null,
  ...extra,
});

function setup(rows: PortRow[], envPort: number | null = null) {
  installMockBridge({
    'ports:list': () => ({ rows, scannedAt: 1, stale: false }),
    'settings:get': () => ({ ...AppSettingsSchema.parse({ watchedPorts: [3000, 5432, 6379] }), readOnly: false }),
    'tools:invoke': (() => ({ port: envPort })) as never,
  });
  renderWithProviders(<PortsCard projectId="p1" />);
}

describe('PortsCard', () => {
  it("lists the project's own ports and the watched ports as free or used", async () => {
    setup([
      row(3000, 40, { owner: { projectId: 'p1', script: 'dev' } }),
      row(4000, 41, { owner: { projectId: 'p1::packages/api', script: 'start' } }),
      row(5432, 77, { processName: 'postgres.exe' }),
      row(8080, 50, { owner: { projectId: 'other', script: 'dev' } }),
    ]);
    const card = await screen.findByRole('region', { name: 'Ports' });
    const own = await within(card).findByRole('list', { name: 'Ports of this project' });
    expect(within(own).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['3000dev', '4000packages/api · start']);
    const watched = within(card).getByRole('list', { name: 'Watched ports' });
    expect(within(watched).getByText('3000').closest('li')).toHaveTextContent('3000dev');
    expect(within(watched).getByText('5432').closest('li')).toHaveTextContent('5432postgres.exe');
    expect(within(watched).getByText('6379').closest('li')).toHaveTextContent('6379free');
  });

  it('says when the project has no ports', async () => {
    setup([]);
    expect(await screen.findByText('No ports open by this project.')).toBeInTheDocument();
  });

  it('shows PORT from .env and who uses it', async () => {
    setup([row(3000, 40, { owner: { projectId: 'p1', script: 'dev' } })], 3000);
    expect(await screen.findByText(/from \.env: used by dev/)).toBeInTheDocument();
  });
});
