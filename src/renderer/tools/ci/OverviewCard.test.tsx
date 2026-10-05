import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CiStatus } from '@shared/tools/ci/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { ciRun, ciStatus } from './fixtures';
import { CiCard } from './OverviewCard';

function renderCard(status: CiStatus) {
  const methods: string[] = [];
  installMockBridge({
    'tools:invoke': (({ method }: { method: string }) => {
      methods.push(method);
      return status;
    }) as never,
  });
  renderWithProviders(<CiCard projectId="p1" />);
  return methods;
}

describe('CiCard', () => {
  it('shows the newest run the tab has seen, without listing runs', async () => {
    const methods = renderCard(
      ciStatus({ latest: ciRun({ state: 'failure', title: 'Fix totals' }) }),
    );
    const card = await screen.findByRole('region', { name: 'CI' });
    expect(card).toHaveTextContent('GitHub Actions · main');
    expect(card).toHaveTextContent('Failed');
    expect(card).toHaveTextContent('Fix totals');
    expect(methods).toEqual(['status']);
  });

  it('invites a look until a run is known', async () => {
    renderCard(ciStatus());
    expect(await screen.findByText("Open the tab to see this branch's runs.")).toBeInTheDocument();
  });
});
