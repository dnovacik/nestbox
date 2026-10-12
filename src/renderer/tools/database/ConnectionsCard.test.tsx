import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { DbConnection, DbStatus } from '@shared/tools/database/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { DatabaseCard } from './OverviewCard';
import { dbStatus } from './fixtures';
import DatabasePanel from './Panel';

const conn = (
  name: string,
  file: string,
  host: string,
  reach: DbConnection['reach'],
): DbConnection => ({
  name,
  file,
  target: { provider: 'postgresql', host, port: 5432, database: 'shop', file: null },
  reach,
});

/** A .NET package without Prisma or DATABASE_URL, with two connections per environment. */
function dotnetStatus(environment: string): DbStatus {
  const dev = environment === 'Development';
  return dbStatus({
    prisma: null,
    url: { state: 'missing', configTs: false },
    reach: null,
    dotnet: {
      environment,
      environments: ['Development', 'Production'],
      connections: [
        conn(
          'Shop',
          dev ? 'appsettings.Development.json' : 'appsettings.json',
          dev ? 'localhost' : 'prod.db',
          dev
            ? { result: 'reachable', reason: null }
            : { result: 'refused', reason: 'ECONNREFUSED' },
        ),
        {
          name: 'Legacy',
          file: 'appsettings.json',
          target: {
            provider: 'sqlserver',
            host: 'localhost',
            port: null,
            database: 'Old',
            file: null,
          },
          reach: { result: 'not-checked', reason: 'A named instance is found through SQL Browser' },
        },
      ],
      truncated: false,
    },
  });
}

function setup() {
  const inputs: unknown[] = [];
  installMockBridge({
    'tools:invoke': (({ method, input }: { method: string; input: { environment?: string } }) => {
      if (method !== 'status') return undefined;
      inputs.push(input);
      return dotnetStatus(input.environment ?? 'Development');
    }) as never,
  });
  renderWithProviders(<DatabasePanel projectId="p1" />);
  return { inputs };
}

describe('Connections card', () => {
  it('lists each connection with its target, source file and reachability', async () => {
    setup();
    const card = await screen.findByRole('region', { name: 'Connections' });
    const shop = within(card).getByRole('listitem', { name: 'Shop' });
    expect(shop).toHaveTextContent('postgresql · localhost:5432/shop');
    expect(shop).toHaveTextContent('appsettings.Development.json');
    expect(within(shop).getByText('Reachable')).toHaveClass('text-ok');
    const legacy = within(card).getByRole('listitem', { name: 'Legacy' });
    expect(legacy).toHaveTextContent('Not checked');
    expect(legacy).toHaveTextContent('A named instance is found through SQL Browser');
    expect(card).toHaveTextContent(
      'appsettings only: .NET also reads environment variables and user secrets.',
    );
  });

  it('reads another environment from the select', async () => {
    const { inputs } = setup();
    const card = await screen.findByRole('region', { name: 'Connections' });
    expect(within(card).getByRole('combobox', { name: 'Environment' })).toHaveValue('Development');
    await userEvent.selectOptions(
      within(card).getByRole('combobox', { name: 'Environment' }),
      'Production',
    );
    await waitFor(() =>
      expect(within(card).getByRole('listitem', { name: 'Shop' })).toHaveTextContent('prod.db'),
    );
    expect(within(card).getByRole('listitem', { name: 'Shop' })).toHaveTextContent(
      'appsettings.json',
    );
    expect(inputs).toContainEqual({ environment: 'Production' });
  });

  it('shows no DATABASE_URL or Prisma lines in a .NET package without them', async () => {
    setup();
    await screen.findByRole('region', { name: 'Connections' });
    expect(screen.queryByRole('region', { name: 'Connection' })).toBeNull();
    expect(screen.queryByText(/DATABASE_URL/)).toBeNull();
    expect(screen.queryByText(/No Prisma schema/)).toBeNull();
  });

  it('says when an environment has no connection strings', async () => {
    installMockBridge({
      'tools:invoke': (() =>
        dbStatus({
          prisma: null,
          url: { state: 'missing', configTs: false },
          reach: null,
          dotnet: {
            environment: 'Production',
            environments: ['Production'],
            connections: [],
            truncated: false,
          },
        })) as never,
    });
    renderWithProviders(<DatabasePanel projectId="p1" />);
    expect(
      await screen.findByText('No ConnectionStrings in appsettings for Production.'),
    ).toBeInTheDocument();
  });
});

describe('DatabaseCard (.NET)', () => {
  it('counts connections and those that answer, in the err tone when one fails', async () => {
    installMockBridge({ 'tools:invoke': (() => dotnetStatus('Production')) as never });
    renderWithProviders(<DatabaseCard projectId="p1" />);
    const card = await screen.findByRole('region', { name: 'Database' });
    expect(await within(card).findByText('2 connections · 0 answer')).toHaveClass('text-err');
    expect(within(card).queryByText(/DATABASE_URL/)).toBeNull();
  });
});
