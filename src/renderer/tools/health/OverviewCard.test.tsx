import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { HealthStatus } from '@shared/tools/health/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { useUiStore } from '@/state/ui-store';
import { checkResult, checkView, healthStatus } from './fixtures';
import { HealthCard } from './OverviewCard';

type Call = { method: string; input: unknown };

async function renderCard(status: HealthStatus) {
  const calls: Call[] = [];
  installMockBridge({
    'tools:invoke': (({ method, input }: Call) => {
      calls.push({ method, input });
      return method === 'status' ? status : undefined;
    }) as never,
  });
  renderWithProviders(<HealthCard projectId="p1" />);
  const card = await screen.findByRole('region', { name: 'Health' });
  return { card, of: (m: string) => calls.filter((c) => c.method === m).map((c) => c.input) };
}

describe('HealthCard', () => {
  it('shows one row per check with its dot and latency', async () => {
    const { card } = await renderCard(
      healthStatus({
        live: true,
        checks: [
          checkView('a', 'http://localhost:3000/', checkResult('ok')),
          checkView('b', 'API_URL · api.local:4000/', checkResult('fail'), { kind: 'env' }),
        ],
      }),
    );
    expect(await within(card).findByText('Running')).toBeInTheDocument();
    const rows = within(card).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      'localhost:3000/12 ms',
      'API_URL · api.local:4000/ECONNREFUSED',
    ]);
    expect(within(rows[0] as HTMLElement).getByTitle('Healthy')).toHaveClass('bg-ok');
    expect(within(rows[1] as HTMLElement).getByTitle('Failing')).toHaveClass('bg-err');
  });

  it('says idle while no script runs', async () => {
    const { card } = await renderCard(
      healthStatus({ checks: [checkView('a', 'http://localhost:3000/', checkResult('idle'))] }),
    );
    expect(await within(card).findByText('Idle (no scripts running)')).toBeInTheDocument();
    expect(within(card).getByTitle('Not checked')).toHaveClass('bg-fg-faint');
  });

  it('offers the PORT suggestion when there are no checks, and opens the tab', async () => {
    const { card, of } = await renderCard(
      healthStatus({ suggestions: { port: 3000, envKeys: [] } }),
    );
    expect(await within(card).findByText('No checks')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Add localhost:3000' }));
    expect(of('addCheck')).toEqual([{ check: { kind: 'url', url: 'http://localhost:3000/' } }]);
    await userEvent.click(within(card).getByRole('button', { name: 'Open Health' }));
    expect(useUiStore.getState().activeTab.p1).toBe('health');
  });
});
