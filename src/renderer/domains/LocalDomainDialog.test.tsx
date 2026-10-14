import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { LocalDomainDialog } from './LocalDomainDialog';

describe('LocalDomainDialog', () => {
  it('validates and saves a label, and switches the Host rewrite', async () => {
    const seen: unknown[] = [];
    const status = {
      enabled: true,
      http: { state: 'running', port: 80, code: null, owner: null },
      https: { state: 'running', port: 443, code: null, owner: null },
      trust: 'trusted',
      routes: [
        {
          name: 'shop.localhost',
          projectId: 'p1',
          script: null,
          port: null,
          source: 'none',
          rewriteHost: false,
        },
      ],
      clashes: [],
    };
    installMockBridge({
      'domains:status': () => status,
      'domains:setName': (i: unknown) => (seen.push(i), status),
      'domains:setRewriteHost': (i: unknown) => (seen.push(i), status),
    } as never);
    renderWithProviders(<LocalDomainDialog projectId="p1" open onOpenChange={() => {}} />);
    const input = await screen.findByLabelText('Name');
    await userEvent.clear(input);
    await userEvent.type(input, 'Bad Name');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, 'store');
    await userEvent.click(screen.getByRole('switch', { name: 'Rewrite the Host header' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(seen).toEqual([
        { projectId: 'p1', rewrite: true },
        { projectId: 'p1', label: 'store' },
      ]),
    );
  });
});
