import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { EnvCard } from './OverviewCard';

describe('EnvCard', () => {
  it('shows the file count, flagged keys and the active profile', async () => {
    installMockBridge({
      'tools:invoke': (() => ({
        files: [{ name: '.env', version: 'v', readOnly: false, entries: 1, duplicates: [] }],
        keys: [{ key: 'A', cells: { '.env': 'set' }, missing: false, undocumented: true }],
        example: null,
        profiles: [{ name: 'staging', file: '.env.staging', active: true }],
      })) as never,
    });
    renderWithProviders(<EnvCard projectId="p1" />);
    const card = await screen.findByRole('region', { name: 'Env' });
    expect(await within(card).findByText('staging')).toBeInTheDocument();
    expect(within(card).getByText('Flagged keys').nextSibling).toHaveTextContent('1');
  });
});
