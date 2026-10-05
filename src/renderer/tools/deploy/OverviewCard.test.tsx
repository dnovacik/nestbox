import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { DeployStatus } from '@shared/tools/deploy/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { useUiStore } from '@/state/ui-store';
import { deployStatus, platformStatus } from './fixtures';
import { DeployCard } from './OverviewCard';

type Call = { method: string; input: unknown };

async function renderCard(status: DeployStatus) {
  const calls: Call[] = [];
  installMockBridge({
    'tools:invoke': (({ method, input }: Call) => {
      calls.push({ method, input });
      return status;
    }) as never,
  });
  renderWithProviders(<DeployCard projectId="p1" />);
  const card = await screen.findByRole('region', { name: 'Deploy' });
  return { card, methods: () => calls.map((c) => c.method) };
}

describe('DeployCard', () => {
  it('shows each platform from local facts and never lists deployments', async () => {
    const { card, methods } = await renderCard(
      deployStatus([
        platformStatus(),
        platformStatus({ platform: 'netlify', linked: false, name: null }),
        platformStatus({ platform: 'fly', cli: 'missing', name: 'shop-api' }),
      ]),
    );
    expect(await within(card).findByText('shop')).toBeInTheDocument();
    expect(within(card).getByText('not linked')).toBeInTheDocument();
    expect(within(card).getByText('CLI not installed')).toBeInTheDocument();
    expect(methods()).not.toContain('deployments');
  });

  it('shows a running deploy, then the last one, and opens the tab', async () => {
    const running = await renderCard(
      deployStatus([platformStatus()], { action: { platform: 'vercel', target: 'preview' } }),
    );
    expect(
      await within(running.card).findByText('Deploying preview to Vercel…'),
    ).toBeInTheDocument();
    await userEvent.click(within(running.card).getByRole('button', { name: 'Open Deploy' }));
    expect(useUiStore.getState().activeTab.p1).toBe('deploy');
  });

  it('says when the last deploy failed', async () => {
    const { card } = await renderCard(
      deployStatus([platformStatus()], {
        last: { platform: 'vercel', target: 'production', ok: false, url: null, at: Date.now() },
      }),
    );
    expect(
      await within(card).findByText(/Last deploy failed: production to Vercel/),
    ).toBeInTheDocument();
  });
});

describe('DeployCard without a platform', () => {
  it('stays off the overview', async () => {
    installMockBridge({ 'tools:invoke': (() => deployStatus([])) as never });
    renderWithProviders(<DeployCard projectId="p1" />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('region', { name: 'Deploy' })).toBeNull();
  });
});
