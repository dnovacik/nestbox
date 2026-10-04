import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ComposeStatus } from '@shared/tools/compose/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { composeStatus, service } from './fixtures';
import ComposePanel from './Panel';

type Call = { method: string; input: unknown };

beforeAll(() => {
  // react-virtual sizes its viewport from offsetHeight/offsetWidth, which jsdom reports as 0.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 400,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 800,
  });
});

function setup(status: ComposeStatus) {
  const calls: Call[] = [];
  installMockBridge({
    'tools:invoke': (({ method, input }: Call) => {
      calls.push({ method, input });
      if (method === 'status') return status;
      if (method === 'getLogs') return { lines: [], firstSeq: 1, lastSeq: 0 };
      if (method === 'follow' || method === 'unfollow' || method === 'clearLogs') return undefined;
      return { ok: true, code: 0 };
    }) as never,
  });
  const view = renderWithProviders(<ComposePanel projectId="p1" />);
  return { view, of: (m: string) => calls.filter((c) => c.method === m).map((c) => c.input) };
}

const STATUS = composeStatus([
  service('db', { health: 'healthy', ports: [{ published: 5432, target: 5432, protocol: 'tcp' }] }),
  service('web', {
    state: 'exited',
    exitCode: 0,
    ports: [{ published: 8080, target: 3000, protocol: 'tcp' }],
  }),
]);

describe('ComposePanel', () => {
  it('lists services with state and ports, and acts on one', async () => {
    const { of } = setup(STATUS);
    const list = await screen.findByRole('list', { name: 'Services' });
    const [db, web] = within(list).getAllByRole('listitem') as [HTMLElement, HTMLElement];
    expect(db).toHaveTextContent('running · healthy');
    expect(db).toHaveTextContent('5432→5432');
    expect(web).toHaveTextContent('exited (0)');
    await userEvent.click(within(db).getByRole('button', { name: 'Stop db' }));
    await userEvent.click(within(db).getByRole('button', { name: 'Restart db' }));
    await userEvent.click(within(web).getByRole('button', { name: 'Start web' }));
    expect(of('stop')).toEqual([{ service: 'db' }]);
    expect(of('restart')).toEqual([{ service: 'db' }]);
    expect(of('up')).toEqual([{ service: 'web' }]);
  });

  it('asks before Down', async () => {
    const { of } = setup(STATUS);
    await userEvent.click(await screen.findByRole('button', { name: 'Down' }));
    expect(await screen.findByText(/Volumes are kept/)).toBeInTheDocument();
    expect(of('down')).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove containers' }));
    expect(of('down')).toEqual([{}]);
  });

  it('follows the logs of the picked service and stops when going back to Actions', async () => {
    const { of } = setup(STATUS);
    const list = await screen.findByRole('list', { name: 'Services' });
    await userEvent.click(within(list).getByRole('button', { name: 'Logs of db' }));
    await waitFor(() => expect(of('follow')).toEqual([{ service: 'db' }]));
    expect(screen.getByRole('button', { name: 'db', pressed: true })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Actions', pressed: false }));
    await waitFor(() => expect(of('unfollow')).toHaveLength(1));
  });

  it('disables actions while one runs', async () => {
    setup(
      composeStatus(STATUS.state === 'ok' ? STATUS.services : [], {
        action: { name: 'up', service: null },
      }),
    );
    expect(await screen.findByRole('button', { name: 'Up all' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop db' })).toBeDisabled();
  });
});
