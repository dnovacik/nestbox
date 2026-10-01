import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestboxError } from '@shared/errors';
import { ServerConfigSchema, type ServerConfig, type ServerStatus } from '@shared/tools/static/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import StaticPanel from './Panel';

const stopped: ServerStatus = {
  running: false,
  folder: 'C:\\Dev\\Shop\\dist',
  port: null,
  localUrl: null,
  lanUrls: [],
  configChanged: false,
  servesPackageRoot: false,
};
const running: ServerStatus = { ...stopped, running: true, port: 4173, localUrl: 'http://localhost:4173/' };

type Call = { method: string; input: Record<string, unknown> };

function setup(over: Partial<Record<string, (input: Record<string, unknown>) => unknown>> = {}) {
  let status = stopped;
  let config: ServerConfig = ServerConfigSchema.parse({});
  const calls: Call[] = [];
  const bridge = installMockBridge({
    'tools:invoke': (({ method, input }: Call) => {
      calls.push({ method, input });
      const handler = over[method];
      if (handler) return handler(input);
      switch (method) {
        case 'status':
          return status;
        case 'config':
          return config;
        case 'setConfig':
          config = input['config'] as ServerConfig;
          return config;
        case 'start':
          status = config.lan ? { ...running, lanUrls: ['http://192.168.1.20:4173/'] } : running;
          return status;
        case 'stop':
          status = stopped;
          return status;
        case 'running':
          return status.running ? [{ projectId: 'p1', url: 'http://localhost:4173/' }] : [];
        case 'getLogs':
          return { lines: [], firstSeq: 1, lastSeq: 0 };
        case 'nextFreePort':
          return { port: 4174 };
        case 'pickFolder':
          return { folder: 'build' };
        default:
          throw new Error(`unexpected ${method}`);
      }
    }) as never,
    'app:openExternal': () => undefined,
  });
  renderWithProviders(<StaticPanel projectId="p1" />);
  return { bridge, of: (m: string) => calls.filter((c) => c.method === m).map((c) => c.input) };
}

// The request log is a LogView (react-virtual): give jsdom a layout size.
const layout = { offsetHeight: 400, offsetWidth: 800 };
const originals = Object.fromEntries(Object.keys(layout).map((k) => [k, Object.getOwnPropertyDescriptor(HTMLElement.prototype, k)]));
beforeAll(() => {
  for (const [k, v] of Object.entries(layout)) Object.defineProperty(HTMLElement.prototype, k, { configurable: true, get: () => v });
});
afterAll(() => {
  for (const [k, d] of Object.entries(originals)) if (d) Object.defineProperty(HTMLElement.prototype, k, d);
});

describe('StaticPanel', () => {
  it('starts the server and shows its URL, then stops it', async () => {
    const { of } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Start' }));
    expect(await screen.findByRole('link', { name: 'http://localhost:4173/' })).toBeInTheDocument();
    expect(of('start')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(of('stop')).toHaveLength(1));
  });

  it('opens a URL in the browser', async () => {
    const { bridge } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Start' }));
    await userEvent.click(await screen.findByRole('link', { name: 'http://localhost:4173/' }));
    expect(bridge.callsTo('app:openExternal')).toEqual([{ url: 'http://localhost:4173/' }]);
  });

  it('saves toggles and the port', async () => {
    const { of } = setup();
    await userEvent.click(await screen.findByRole('switch', { name: 'CORS' }));
    await waitFor(() => expect(of('setConfig').at(-1)).toEqual({ config: expect.objectContaining({ cors: true }) }));
    const port = screen.getByRole('spinbutton', { name: 'Port' });
    await userEvent.type(port, '5000');
    await userEvent.tab();
    await waitFor(() => expect(of('setConfig').at(-1)).toEqual({ config: expect.objectContaining({ port: 5000 }) }));
  });

  it('shows the LAN URL and its QR code when shared on the LAN', async () => {
    setup();
    await userEvent.click(await screen.findByRole('switch', { name: 'Share on LAN' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByRole('link', { name: 'http://192.168.1.20:4173/' })).toBeInTheDocument();
    const qr = screen.getByRole('img', { name: 'QR code for http://192.168.1.20:4173/' });
    expect(qr.querySelectorAll('rect').length).toBeGreaterThan(50);
  });

  it('offers the next free port when the port is in use', async () => {
    const { of } = setup({
      start: () => {
        throw new NestboxError('CONFLICT', 'Port 4173 is in use');
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Start' }));
    expect(await screen.findByText('Port 4173 is in use')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use port 4174' }));
    await waitFor(() => expect(of('setConfig').at(-1)).toEqual({ config: expect.objectContaining({ port: 4174 }) }));
  });

  it('picks a folder', async () => {
    const { of } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Browse…' }));
    await waitFor(() => expect(of('setConfig').at(-1)).toEqual({ config: expect.objectContaining({ folder: 'build' }) }));
  });

  it('warns when the package folder itself is served', async () => {
    setup({ status: () => ({ ...stopped, servesPackageRoot: true }) });
    expect(await screen.findByText(/serves the whole package folder/)).toBeInTheDocument();
  });

  it('says a restart is needed when a running config changed', async () => {
    setup({ status: () => ({ ...running, configChanged: true }) });
    expect(await screen.findByText('Restart to apply the changes.')).toBeInTheDocument();
  });

  it('shows the request log', async () => {
    const { bridge } = setup();
    await screen.findByRole('button', { name: 'Start' });
    act(() =>
      bridge.emit('tools:event', {
        toolId: 'static',
        projectId: 'p1',
        event: 'logs',
        payload: { lines: [{ seq: 1, ts: 1, stream: 'stdout', text: '200 GET /index.html 2 ms' }] },
      }),
    );
    const log = await screen.findByRole('log', { name: 'Requests output' });
    expect(await within(log).findByText(/GET \/index\.html/)).toBeInTheDocument();
  });
});
