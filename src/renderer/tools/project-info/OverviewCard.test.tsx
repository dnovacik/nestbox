import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { NestboxError } from '@shared/errors';
import { makeDetected } from '@/test/fixtures';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { ProjectInfoCard } from './OverviewCard';

describe('ProjectInfoCard', () => {
  it('shows a skeleton while loading', () => {
    installMockBridge({ 'tools:invoke': () => new Promise(() => {}) });
    renderWithProviders(<ProjectInfoCard projectId="p1" />);
    expect(screen.getByRole('region', { name: 'Project info' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('project-info-skeleton')).toBeInTheDocument();
  });

  it('shows an error with a working retry', async () => {
    let fail = true;
    installMockBridge({
      'tools:invoke': () => {
        if (fail) throw new NestboxError('INTERNAL', 'boom');
        return makeDetected();
      },
    });
    renderWithProviders(<ProjectInfoCard projectId="p1" />);
    expect(await screen.findByText("Couldn't load project info.")).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('pnpm')).toBeInTheDocument();
  });
});
