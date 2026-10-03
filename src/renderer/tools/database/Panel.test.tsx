import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbStatus } from '@shared/tools/database/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { dbStatus } from './fixtures';
import DatabasePanel from './Panel';

type Call = { method: string; input: unknown };

function setup(status: DbStatus, over: Record<string, (input: unknown) => unknown> = {}) {
  const calls: Call[] = [];
  const bridge = installMockBridge({
    'tools:invoke': (({ method, input }: Call) => {
      calls.push({ method, input });
      if (over[method]) return over[method](input);
      switch (method) {
        case 'status':
          return status;
        case 'getLogs':
          return { lines: [], firstSeq: 1, lastSeq: 0 };
        case 'testLogin':
          return { ok: false, message: 'Wrong user or password' };
        case 'startStudio':
          return { port: 5556 };
        default:
          return undefined;
      }
    }) as never,
    'app:openExternal': () => undefined,
  });
  renderWithProviders(<DatabasePanel projectId="p1" />);
  return { bridge, of: (m: string) => calls.filter((c) => c.method === m).map((c) => c.input) };
}

// The Prisma log is a LogView (react-virtual): give jsdom a layout size.
const layout = { offsetHeight: 400, offsetWidth: 800 };
const originals = Object.fromEntries(Object.keys(layout).map((k) => [k, Object.getOwnPropertyDescriptor(HTMLElement.prototype, k)]));
beforeAll(() => {
  for (const [k, v] of Object.entries(layout)) Object.defineProperty(HTMLElement.prototype, k, { configurable: true, get: () => v });
});
afterAll(() => {
  for (const [k, d] of Object.entries(originals)) if (d) Object.defineProperty(HTMLElement.prototype, k, d);
});

describe('DatabasePanel', () => {
  it('shows the connection and tests the login', async () => {
    const { of } = setup(dbStatus());
    const connection = await screen.findByRole('region', { name: 'Connection' });
    expect(within(connection).getByText('postgresql · localhost:5432/shop')).toBeInTheDocument();
    expect(within(connection).getByText('.env')).toBeInTheDocument();
    expect(within(connection).getByText('Reachable')).toBeInTheDocument();
    await userEvent.click(within(connection).getByRole('button', { name: 'Test login' }));
    expect(await within(connection).findByText('Wrong user or password')).toHaveClass('text-err');
    expect(of('testLogin')).toHaveLength(1);
  });

  it('runs Prisma commands, opens migrate dev in a terminal and starts Studio', async () => {
    const { of } = setup(dbStatus());
    const prisma = await screen.findByRole('region', { name: 'Prisma' });
    await userEvent.click(within(prisma).getByRole('button', { name: 'Migrate status' }));
    await userEvent.click(within(prisma).getByRole('button', { name: 'Generate' }));
    await userEvent.click(within(prisma).getByRole('button', { name: 'Migrate dev' }));
    await userEvent.click(within(prisma).getByRole('button', { name: 'Start Studio' }));
    expect(of('run')).toEqual([{ command: 'migrate-status' }, { command: 'generate' }]);
    expect(of('migrateDev')).toHaveLength(1);
    expect(of('startStudio')).toHaveLength(1);
    expect(screen.getByRole('log', { name: 'Prisma output' })).toBeInTheDocument();
  });

  it('shows a running command with Stop, and a running Studio with Open and Stop', async () => {
    const { of, bridge } = setup(dbStatus({ running: { command: 'generate', studio: { port: 5556 } } }));
    const prisma = await screen.findByRole('region', { name: 'Prisma' });
    expect(within(prisma).getByRole('button', { name: 'Generate' })).toBeDisabled();
    await userEvent.click(within(prisma).getByRole('button', { name: 'Stop' }));
    await userEvent.click(within(prisma).getByRole('button', { name: 'Open Studio' }));
    await userEvent.click(within(prisma).getByRole('button', { name: 'Stop Studio' }));
    expect(of('stop')).toEqual([{ what: 'command' }, { what: 'studio' }]);
    expect(bridge.callsTo('app:openExternal')).toEqual([{ url: 'http://localhost:5556' }]);
  });

  it('offers only the connection check without a Prisma schema', async () => {
    setup(dbStatus({ prisma: null }));
    expect(await screen.findByText(/only the connection check is available/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Prisma' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Test login' })).toBeDisabled();
    expect(screen.getByText('Needs a Prisma schema')).toBeInTheDocument();
  });

  it('cannot test a MongoDB login', async () => {
    const target = { provider: 'mongodb', host: 'localhost', port: 27017, database: 'app', file: null, source: '.env' as const };
    setup(dbStatus({ url: { state: 'set', target } }));
    expect(await screen.findByText("Prisma can't run SQL against MongoDB")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test login' })).toBeDisabled();
  });

  it('explains a missing URL', async () => {
    setup(dbStatus({ url: { state: 'missing', configTs: false }, reach: null }));
    expect(await screen.findByText('No DATABASE_URL in .env or prisma/.env.')).toBeInTheDocument();
  });
});
