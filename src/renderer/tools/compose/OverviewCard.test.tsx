import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ComposeStatus } from '@shared/tools/compose/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { useUiStore } from '@/state/ui-store';
import { composeStatus, service } from './fixtures';
import { ComposeCard } from './OverviewCard';

type Call = { method: string; input: unknown };

async function renderCard(status: ComposeStatus) {
  const calls: Call[] = [];
  installMockBridge({
    'tools:invoke': (({ method, input }: Call) => {
      calls.push({ method, input });
      return method === 'status' ? status : { ok: true, code: 0 };
    }) as never,
  });
  renderWithProviders(<ComposeCard projectId="p1" />);
  const card = await screen.findByRole('region', { name: 'Compose' });
  return { card, of: (m: string) => calls.filter((c) => c.method === m).map((c) => c.input) };
}

describe('ComposeCard', () => {
  it('counts running services and shows a dot per service', async () => {
    const { card } = await renderCard(
      composeStatus([
        service('db', { health: 'healthy' }),
        service('web', { state: 'exited', exitCode: 1 }),
        service('cache', { state: 'not-created', exitCode: null }),
      ]),
    );
    expect(await within(card).findByText('1 of 3 running')).toBeInTheDocument();
    expect(within(card).getByTitle('db: running · healthy')).toHaveClass('bg-ok');
    expect(within(card).getByTitle('web: exited (1)')).toHaveClass('bg-err');
    expect(within(card).getByTitle('cache: not created')).toHaveClass('bg-fg-faint');
  });

  it('brings the stack up and down, and opens the tab', async () => {
    const { card, of } = await renderCard(composeStatus([service('db')]));
    await userEvent.click(await within(card).findByRole('button', { name: 'Up all' }));
    await userEvent.click(within(card).getByRole('button', { name: 'Stop all' }));
    expect([...of('up'), ...of('stop')]).toEqual([{}, {}]);
    await userEvent.click(within(card).getByRole('button', { name: 'Open Compose' }));
    expect(useUiStore.getState().activeTab.p1).toBe('compose');
  });

  it('says when Docker is not running', async () => {
    const { card } = await renderCard({ state: 'daemon-down', file: 'compose.yaml' });
    expect(
      await within(card).findByText("Docker isn't running: start Docker Desktop."),
    ).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Up all' })).toBeNull();
  });
});
