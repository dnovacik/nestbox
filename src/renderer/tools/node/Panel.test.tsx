import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { NodeStatus } from '@shared/tools/node/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { nodeStatus } from './fixtures';
import NodePanel from './Panel';

function setup(initial: NodeStatus) {
  const calls: { method: string; input: unknown }[] = [];
  let status = initial;
  installMockBridge({
    'tools:invoke': (({ method, input }: { method: string; input: unknown }) => {
      calls.push({ method, input });
      if (method === 'setFnm')
        status = { ...status, fnm: { ...status.fnm, on: (input as { enabled: boolean }).enabled } };
      return status;
    }) as never,
  });
  renderWithProviders(<NodePanel projectId="p1" />);
  return { calls };
}

describe('NodePanel', () => {
  it('lists every source with the one used, disagreements and unreadable values', async () => {
    setup(
      nodeStatus({
        state: 'conflict',
        sources: [
          { kind: 'nvmrc', value: '20', fromRoot: true, valid: true, conflict: false },
          { kind: 'engines', value: '>=22', fromRoot: false, valid: true, conflict: true },
          { kind: 'volta', value: 'banana', fromRoot: false, valid: false, conflict: false },
        ],
      }),
    );
    const list = await screen.findByRole('list', { name: 'Sources' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('.nvmrc20from the rootused');
    expect(rows[1]).toHaveTextContent('engines.node>=22disagrees');
    expect(rows[2]).toHaveTextContent('volta.nodebananaunreadable');
    expect(screen.getByText('The sources disagree')).toBeInTheDocument();
  });

  it('explains the version manager and switches fnm on', async () => {
    const { calls } = setup(
      nodeStatus({ manager: 'fnm', fnm: { available: true, on: false, version: '20' } }),
    );
    expect(await screen.findByText(/fnm can run this project's scripts/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: 'Run scripts with fnm' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'setFnm')).toEqual([
        { method: 'setFnm', input: { enabled: true } },
      ]),
    );
    expect(await screen.findByRole('switch', { name: 'Run scripts with fnm' })).toBeChecked();
  });

  it('only warns with nvm-windows, and refreshes on demand', async () => {
    const { calls } = setup(nodeStatus({ manager: 'nvm-windows' }));
    expect(
      await screen.findByText(/nvm-windows switches Node for the whole machine/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'refresh')).toBe(true));
  });
});
