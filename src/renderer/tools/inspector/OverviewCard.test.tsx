import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { EntrySummary, InspectorStatus } from '@shared/tools/inspector/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { useUiStore } from '@/state/ui-store';
import { inspectorConfig, inspectorStatus, summary } from './fixtures';
import { InspectorCard } from './OverviewCard';

type Call = { method: string };

async function renderCard(status: InspectorStatus, list: EntrySummary[] = []) {
  const calls: Call[] = [];
  installMockBridge({
    'tools:invoke': (({ method }: Call) => {
      calls.push({ method });
      return method === 'config' ? inspectorConfig() : method === 'list' ? list : status;
    }) as never,
  });
  renderWithProviders(<InspectorCard projectId="p1" />);
  const card = await screen.findByRole('region', { name: 'Inspector' });
  return { card, of: (m: string) => calls.filter((c) => c.method === m) };
}

describe('InspectorCard', () => {
  it('shows where it forwards, the count and the last status while running', async () => {
    const { card, of } = await renderCard(
      inspectorStatus({ running: true, port: 4020, url: 'http://localhost:4020', count: 2 }),
      [summary('b', { status: 500 }), summary('a')],
    );
    expect(await within(card).findByText('localhost:4020 → localhost:3000')).toBeInTheDocument();
    expect(within(card).getByText(/2 requests/)).toBeInTheDocument();
    expect(await within(card).findByText('500')).toHaveClass('text-err');
    await userEvent.click(within(card).getByRole('button', { name: 'Stop' }));
    expect(of('stop')).toHaveLength(1);
  });

  it('says stopped, starts, and opens the tab', async () => {
    const { card, of } = await renderCard(inspectorStatus());
    expect(await within(card).findByText('Stopped')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Start' }));
    expect(of('start')).toHaveLength(1);
    await userEvent.click(within(card).getByRole('button', { name: 'Open Inspector' }));
    expect(useUiStore.getState().activeTab.p1).toBe('inspector');
  });
});
