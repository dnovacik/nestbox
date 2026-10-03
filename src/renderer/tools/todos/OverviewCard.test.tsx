import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { TodoScan } from '@shared/tools/todos/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { useUiStore } from '@/state/ui-store';
import { todo, todoScan } from './fixtures';
import { TodosCard } from './OverviewCard';

async function renderCard(result: TodoScan | null) {
  installMockBridge({ 'tools:invoke': (({ method }: { method: string }) => (method === 'results' ? result : todoScan([]))) as never });
  renderWithProviders(<TodosCard projectId="p1" />);
  return screen.findByRole('region', { name: 'TODOs' });
}

describe('TodosCard', () => {
  it('counts TODOs per tag and says when it scanned', async () => {
    const card = await renderCard(
      todoScan([todo('a.ts', 1, 'TODO', 'x'), todo('a.ts', 4, 'TODO', 'y'), todo('b.py', 2, 'FIXME', 'z')]),
    );
    expect(await within(card).findByText('3 in 2 files')).toBeInTheDocument();
    expect(within(card).getByText('TODO 2')).toBeInTheDocument();
    expect(within(card).getByText('FIXME 1')).toHaveClass('text-err');
    expect(within(card).getByText('scanned 5 min ago')).toBeInTheDocument();
  });

  it('says when a limit stopped the scan', async () => {
    const card = await renderCard(todoScan([todo('a.ts', 1, 'TODO', 'x')], { truncated: 'matches' }));
    expect(await within(card).findByText('1+ in 1 files')).toBeInTheDocument();
    expect(within(card).getByText(/Stopped at 5,000 TODOs/)).toBeInTheDocument();
  });

  it('runs the first scan itself, and opens the tab', async () => {
    const card = await renderCard(null);
    expect(await within(card).findByText('None found')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Open TODOs' }));
    expect(useUiStore.getState().activeTab.p1).toBe('todos');
  });
});
