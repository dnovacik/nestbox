import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type {
  EntrySummary,
  InspectorStatus,
  PackageInspector,
} from '@shared/tools/inspector/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { detail, inspectorConfig, inspectorStatus, summary } from './fixtures';
import InspectorPanel from './Panel';

type Call = { method: string; input: unknown };

const LIST = [
  summary('b', { method: 'POST', path: '/orders', status: 201, replayOf: 'a' }),
  summary('a'),
];

function setup(
  opts: { status?: InspectorStatus; config?: PackageInspector; list?: EntrySummary[] } = {},
) {
  const calls: Call[] = [];
  const list = opts.list ?? LIST;
  installMockBridge({
    'tools:invoke': (({ method, input }: Call) => {
      calls.push({ method, input });
      switch (method) {
        case 'status':
          return (
            opts.status ??
            inspectorStatus({
              running: true,
              port: 4020,
              url: 'http://localhost:4020',
              count: list.length,
            })
          );
        case 'config':
        case 'setOptions':
          return opts.config ?? inspectorConfig();
        case 'list':
          return list;
        case 'get':
          return detail(list.find((e) => e.id === (input as { id: string }).id) ?? summary('x'));
        case 'reveal':
          return { value: 'Bearer s3cr3t' };
        case 'replay':
        case 'send':
          return { id: 'c' };
        default:
          return undefined;
      }
    }) as never,
  });
  renderWithProviders(<InspectorPanel projectId="p1" />);
  return { of: (m: string) => calls.filter((c) => c.method === m).map((c) => c.input) };
}

describe('InspectorPanel', () => {
  it('lists requests newest first, filters them, and shows one with masked headers', async () => {
    setup();
    const list = await screen.findByRole('list', { name: 'Requests' });
    expect(
      within(list)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([
      expect.stringContaining('POST/ordersreplay201'),
      expect.stringContaining('GET/users/1200'),
    ]);
    await userEvent.type(screen.getByRole('textbox', { name: 'Filter requests' }), 'orders');
    expect(within(list).getAllByRole('button')).toHaveLength(1);
    await userEvent.clear(screen.getByRole('textbox', { name: 'Filter requests' }));

    await userEvent.click(within(list).getByRole('button', { name: /\/users\/1/ }));
    const detailView = await screen.findByRole('region', { name: 'Request detail' });
    expect(await within(detailView).findByLabelText('Body')).toHaveTextContent('"ok": true');
    await userEvent.click(
      within(detailView).getByRole('button', { name: 'Request', pressed: false }),
    );
    const headers = within(detailView).getByRole('table', { name: 'Request headers' });
    expect(headers).toHaveTextContent('••••••');
    await userEvent.click(within(headers).getByRole('button', { name: 'Reveal Authorization' }));
    expect(await within(headers).findByText('Bearer s3cr3t')).toBeInTheDocument();
  });

  it('replays, copies as curl, and clears', async () => {
    const { of } = setup();
    const list = await screen.findByRole('list', { name: 'Requests' });
    await userEvent.click(within(list).getByRole('button', { name: /\/users\/1/ }));
    const detailView = await screen.findByRole('region', { name: 'Request detail' });
    await userEvent.click(await within(detailView).findByRole('button', { name: 'Replay' }));
    await userEvent.click(within(detailView).getByRole('button', { name: 'Copy as curl' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(of('replay')).toEqual([{ id: 'a' }]));
    expect(of('copyCurl')).toEqual([{ id: 'a' }]);
    expect(of('clear')).toEqual([{}]);
  });

  it('edits and sends, keeping a masked header unless it is changed', async () => {
    const { of } = setup();
    const list = await screen.findByRole('list', { name: 'Requests' });
    await userEvent.click(within(list).getByRole('button', { name: /\/users\/1/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Edit & send' }));
    const form = await screen.findByRole('form', { name: 'Edit request' });
    expect(within(form).getByRole('textbox', { name: 'Header 1 name' })).toHaveValue(
      'Authorization',
    );
    expect(within(form).getByRole('textbox', { name: 'Header 1 value' })).toHaveAttribute(
      'placeholder',
      'recorded value',
    );
    const method = within(form).getByRole('textbox', { name: 'Method' });
    await userEvent.clear(method);
    await userEvent.type(method, 'put');
    const body = within(form).getByRole('textbox', { name: 'Body' });
    await userEvent.clear(body);
    await userEvent.type(body, 'changed');
    await userEvent.click(within(form).getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(of('send')).toEqual([
        {
          from: 'a',
          method: 'PUT',
          path: '/users/1',
          headers: [
            { name: 'Authorization', keep: true },
            { name: 'Accept', value: 'application/json' },
          ],
          body: 'changed',
        },
      ]),
    );
  });

  it('saves a local API address and refuses a remote one', async () => {
    const { of } = setup({ status: inspectorStatus() });
    const field = await screen.findByRole('textbox', { name: 'API address' });
    expect(field).toHaveAttribute('placeholder', 'http://localhost:3000 (PORT from .env)');
    await userEvent.type(field, 'http://example.com{Enter}');
    expect(await screen.findByText(/A local address like/)).toBeInTheDocument();
    await userEvent.clear(field);
    await userEvent.type(field, 'http://localhost:8080/api{Enter}');
    await waitFor(() =>
      expect(of('setOptions')).toEqual([{ target: 'http://localhost:8080/api' }]),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(of('start')).toHaveLength(1);
  });
});
