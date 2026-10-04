import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';
import { NestboxError } from '@shared/errors';
import type { MockRoute, MockStatus, PackageMock } from '@shared/tools/mock/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { mockConfig, mockRoute, mockStatus } from './fixtures';
import MockPanel from './Panel';

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

function setup(
  config: PackageMock,
  status: MockStatus = mockStatus(),
  opts: { startFails?: boolean } = {},
) {
  const calls: Call[] = [];
  installMockBridge({
    'tools:invoke': (({ method, input }: Call) => {
      calls.push({ method, input });
      switch (method) {
        case 'config':
        case 'saveRoute':
        case 'deleteRoute':
        case 'moveRoute':
        case 'setOptions':
          return config;
        case 'getLogs':
          return { lines: [], firstSeq: 1, lastSeq: 0 };
        case 'nextFreePort':
          return { port: 4011 };
        case 'start':
          if (opts.startFails) throw new NestboxError('CONFLICT', 'Port 4010 is in use');
          return status;
        default:
          return status;
      }
    }) as never,
  });
  renderWithProviders(<MockPanel projectId="p1" />);
  return { of: (m: string) => calls.filter((c) => c.method === m).map((c) => c.input) };
}

const ROUTES = [
  mockRoute('a', { body: '{"id":"{{params.id}}"}' }),
  mockRoute('b', { method: 'POST', path: '/users', status: 201 }),
];

describe('MockPanel', () => {
  it('lists the routes and acts on them', async () => {
    const { of } = setup(mockConfig({ routes: ROUTES }));
    const list = await screen.findByRole('list', { name: 'Routes' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      expect.stringContaining('GET/users/:id200'),
      expect.stringContaining('POST/users201'),
    ]);
    await userEvent.click(screen.getByRole('switch', { name: 'Fail GET /users/:id' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Enable POST /users' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move POST /users up' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete GET /users/:id' }));
    await userEvent.click(screen.getByRole('button', { name: 'Duplicate POST /users' }));
    const saved = of('saveRoute') as { route: MockRoute }[];
    expect(saved[0]?.route).toMatchObject({ id: 'a', fail: { on: true, status: 500 } });
    expect(saved[1]?.route).toMatchObject({ id: 'b', enabled: false });
    expect(saved[2]?.route).toMatchObject({ method: 'POST', path: '/users' });
    expect(saved[2]?.route.id).not.toBe('b');
    expect(of('moveRoute')).toEqual([{ id: 'b', to: 0 }]);
    expect(of('deleteRoute')).toEqual([{ id: 'a' }]);
    expect(screen.getByRole('button', { name: 'Move GET /users/:id up' })).toBeDisabled();
  });

  it('adds a route through the editor, refusing bad JSON first', async () => {
    const { of } = setup(mockConfig());
    await userEvent.click(await screen.findByRole('button', { name: 'Add route' }));
    const form = await screen.findByRole('form', { name: 'Route' });
    await userEvent.click(within(form).getByRole('button', { name: 'POST', pressed: false }));
    const path = within(form).getByRole('textbox', { name: 'Path' });
    await userEvent.clear(path);
    await userEvent.type(path, '/orders/:id');
    const status = within(form).getByRole('textbox', { name: 'Status' });
    await userEvent.clear(status);
    await userEvent.type(status, '201');
    const body = within(form).getByRole('textbox', { name: 'Body' });
    await userEvent.clear(body);
    await userEvent.type(body, '{{"id": ');
    await userEvent.click(within(form).getByRole('button', { name: 'Add' }));
    expect(within(form).getByText(/^Body: The body isn't valid JSON/)).toBeInTheDocument();
    expect(of('saveRoute')).toEqual([]);

    await userEvent.type(body, '"{{{{params.id}}"}');
    await userEvent.click(within(form).getByRole('button', { name: 'Add header' }));
    await userEvent.type(within(form).getByRole('textbox', { name: 'Header 1 name' }), 'X-Mock');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Header 1 value' }), 'yes');
    await userEvent.click(within(form).getByRole('button', { name: 'Add' }));
    const [saved] = of('saveRoute') as { route: MockRoute }[];
    expect(saved?.route).toMatchObject({
      method: 'POST',
      path: '/orders/:id',
      status: 201,
      body: '{"id": "{{params.id}}"}',
      headers: [{ name: 'X-Mock', value: 'yes' }],
    });
  });

  it('formats a JSON body and refuses a reserved header', async () => {
    setup(mockConfig());
    await userEvent.click(await screen.findByRole('button', { name: 'Add route' }));
    const form = await screen.findByRole('form', { name: 'Route' });
    const body = within(form).getByRole('textbox', { name: 'Body' });
    await userEvent.clear(body);
    await userEvent.type(body, '{{"a":1}');
    await userEvent.click(within(form).getByRole('button', { name: 'Format' }));
    expect(body).toHaveValue('{\n  "a": 1\n}');
    await userEvent.click(within(form).getByRole('button', { name: 'Add header' }));
    await userEvent.type(
      within(form).getByRole('textbox', { name: 'Header 1 name' }),
      'Content-Length',
    );
    await userEvent.click(within(form).getByRole('button', { name: 'Add' }));
    expect(within(form).getByText('Headers: NestBox sets this header itself')).toBeInTheDocument();
  });

  it('saves the global toggles', async () => {
    const { of } = setup(mockConfig());
    const delay = await screen.findByRole('textbox', { name: 'Extra delay (ms)' });
    await userEvent.clear(delay);
    await userEvent.type(delay, '250{Enter}');
    await userEvent.click(screen.getByRole('switch', { name: 'Fail every request' }));
    expect(of('setOptions')).toEqual([{ delayMs: 250 }, { failAll: { on: true, status: 500 } }]);
  });

  it('offers the next free port when the port is in use', async () => {
    const { of } = setup(mockConfig({ port: 4010 }), mockStatus(), { startFails: true });
    await userEvent.click(await screen.findByRole('button', { name: 'Start' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Use port 4011' }));
    await waitFor(() => expect(of('setOptions')).toEqual([{ port: 4011 }]));
    expect(screen.getByText('Port 4010 is in use')).toBeInTheDocument();
  });
});
