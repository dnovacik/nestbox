import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { NodeStatus } from '@shared/tools/node/contract';
import { useUiStore } from '@/state/ui-store';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { nodeStatus } from './fixtures';
import { NodeCard } from './OverviewCard';

async function renderCard(status: NodeStatus) {
  installMockBridge({ 'tools:invoke': (() => status) as never });
  renderWithProviders(<NodeCard projectId="p1" />);
  return screen.findByRole('region', { name: 'Node' });
}

describe('NodeCard', () => {
  it('shows the requirement, its source and the running Node', async () => {
    const card = await renderCard(nodeStatus());
    expect(await within(card).findByText('Versions match')).toBeInTheDocument();
    expect(within(card).getByText(/Needs 20 \(\.nvmrc\)/)).toBeInTheDocument();
    expect(within(card).getByText('v20.11.1')).toBeInTheDocument();
  });

  it('shows a mismatch and the packageManager line', async () => {
    const card = await renderCard(
      nodeStatus({
        state: 'mismatch',
        node: { version: 'v18.19.0', ok: false },
        packageManager: {
          name: 'pnpm',
          version: '10.30.2',
          detected: 'pnpm',
          installed: '9.15.0',
          ok: false,
        },
      }),
    );
    expect(await within(card).findByText("Versions don't match")).toBeInTheDocument();
    expect(within(card).getByText('v18.19.0')).toHaveClass('text-err');
    expect(within(card).getByText('pnpm@10.30.2')).toBeInTheDocument();
    expect(within(card).getByText('installed 9.15.0')).toHaveClass('text-err');
  });

  it('says when there is no requirement, and opens the tab', async () => {
    const card = await renderCard(
      nodeStatus({
        state: 'unknown',
        sources: [],
        requirement: null,
        node: { version: 'v22.1.0', ok: null },
      }),
    );
    expect(await within(card).findByText(/No required version/)).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Open Node' }));
    expect(useUiStore.getState().activeTab['p1']).toBe('node');
  });
});
