import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { DomainsStatus } from '@shared/domains';
import { NestboxError } from '@shared/errors';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { LocalDomainDialog } from './LocalDomainDialog';

const statusNamed = (name: string, rewriteHost = false): DomainsStatus => ({
  enabled: true,
  http: { state: 'running', port: 80, code: null, owner: null },
  https: { state: 'running', port: 443, code: null, owner: null },
  trust: 'trusted',
  routes: [{ name, projectId: 'p1', script: null, port: null, source: 'none', rewriteHost }],
  clashes: [],
});

function Harness({ onOpenChange }: { onOpenChange?(open: boolean): void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Reopen
      </button>
      <LocalDomainDialog
        projectId="p1"
        open={open}
        onOpenChange={(o) => {
          onOpenChange?.(o);
          setOpen(o);
        }}
      />
    </>
  );
}

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

  it('forgets a cancelled edit and shows the name main assigned after a save', async () => {
    let status = statusNamed('shop.localhost');
    installMockBridge({
      'domains:status': () => status,
      'domains:setName': () => (status = statusNamed('store-2.localhost')),
    } as never);
    renderWithProviders(<Harness />);
    const input = await screen.findByLabelText('Name');
    await waitFor(() => expect(input).toHaveValue('shop'));
    await userEvent.clear(input);
    await userEvent.type(input, 'draft');
    await userEvent.click(screen.getByRole('switch', { name: 'Rewrite the Host header' }));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByLabelText('Name')).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(await screen.findByLabelText('Name')).toHaveValue('shop');
    expect(screen.getByRole('switch', { name: 'Rewrite the Host header' })).not.toBeChecked();
    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.type(screen.getByLabelText('Name'), 'store');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByLabelText('Name')).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(await screen.findByLabelText('Name')).toHaveValue('store-2');
  });

  it('stays open when saving fails, and disables Save while a save runs', async () => {
    const closed: boolean[] = [];
    let release: () => void = () => {};
    installMockBridge({
      'domains:status': () => statusNamed('shop.localhost'),
      'domains:setRewriteHost': () =>
        new Promise<DomainsStatus>((resolve) => {
          release = () => resolve(statusNamed('shop.localhost', true));
        }),
      'domains:setName': () => {
        throw new NestboxError('CONFLICT', 'That name is taken');
      },
    } as never);
    renderWithProviders(<Harness onOpenChange={(o) => closed.push(o)} />);
    const input = await screen.findByLabelText('Name');
    await waitFor(() => expect(input).toHaveValue('shop'));
    await userEvent.clear(input);
    await userEvent.type(input, 'store');
    await userEvent.click(screen.getByRole('switch', { name: 'Rewrite the Host header' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled());
    release();
    expect(await screen.findByText('That name is taken')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    expect(screen.getByLabelText('Name')).toHaveValue('store');
    expect(closed).toEqual([]);
  });
});
