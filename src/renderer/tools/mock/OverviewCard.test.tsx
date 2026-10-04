import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { MockStatus, PackageMock } from '@shared/tools/mock/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { useUiStore } from '@/state/ui-store';
import { mockConfig, mockRoute, mockStatus } from './fixtures';
import { MockCard } from './OverviewCard';

type Call = { method: string; input: unknown };

async function renderCard(status: MockStatus, config: PackageMock) {
  const calls: Call[] = [];
  installMockBridge({
    'tools:invoke': (({ method, input }: Call) => {
      calls.push({ method, input });
      return method === 'config' ? config : status;
    }) as never,
  });
  renderWithProviders(<MockCard projectId="p1" />);
  const card = await screen.findByRole('region', { name: 'Mock API' });
  return { card, of: (m: string) => calls.filter((c) => c.method === m) };
}

describe('MockCard', () => {
  it('shows the URL and route count while running, and stops', async () => {
    const { card, of } = await renderCard(
      mockStatus({ running: true, port: 4010, url: 'http://localhost:4010' }),
      mockConfig({ routes: [mockRoute('a'), mockRoute('b')], failAll: { on: true, status: 503 } }),
    );
    expect(await within(card).findByText('http://localhost:4010')).toBeInTheDocument();
    expect(within(card).getByText(/2 routes/)).toBeInTheDocument();
    expect(within(card).getByText(/fail all \(503\)/)).toHaveClass('text-err');
    await userEvent.click(within(card).getByRole('button', { name: 'Stop' }));
    expect(of('stop')).toHaveLength(1);
  });

  it('says stopped, starts, and opens the tab', async () => {
    const { card, of } = await renderCard(mockStatus(), mockConfig({ routes: [mockRoute('a')] }));
    expect(await within(card).findByText('Stopped')).toBeInTheDocument();
    expect(within(card).getByText('1 route')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Start' }));
    expect(of('start')).toHaveLength(1);
    await userEvent.click(within(card).getByRole('button', { name: 'Open Mock API' }));
    expect(useUiStore.getState().activeTab.p1).toBe('mock');
  });
});
