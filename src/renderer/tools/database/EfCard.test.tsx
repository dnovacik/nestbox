import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { DbStatus } from '@shared/tools/database/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { dbStatus } from './fixtures';
import { DatabaseCard } from './OverviewCard';
import DatabasePanel from './Panel';

type Ef = NonNullable<DbStatus['ef']>;

const migrations = [
  { id: '20261001000000_Init', name: 'Init', applied: true },
  { id: '20261005000000_AddProducts', name: 'AddProducts', applied: true },
  { id: '20261010000000_AddOrders', name: 'AddOrders', applied: false },
];

/** A .NET package with EF Core and no Prisma, listed for `environment`. */
function efStatus(
  patch: Partial<Ef> = {},
  environment = 'Development',
  context?: string,
): DbStatus {
  const ef: Ef = {
    tool: 'local',
    contexts: ['ShopDbContext'],
    context: 'ShopDbContext',
    needsRestore: false,
    migrations: { environment, items: migrations },
    ...patch,
  };
  return dbStatus({
    prisma: null,
    url: { state: 'missing', configTs: false },
    reach: null,
    dotnet: {
      environment,
      environments: ['Development', 'Production'],
      connections: [],
      truncated: false,
    },
    ef: {
      ...ef,
      context: context !== undefined && ef.contexts.includes(context) ? context : ef.context,
    },
  });
}

type Invoke = { method: string; input: { environment?: string; context?: string } };

function setup(patch: Partial<Ef> = {}) {
  const status: unknown[] = [];
  const ef: unknown[] = [];
  const other: string[] = [];
  installMockBridge({
    'tools:invoke': (({ method, input }: Invoke) => {
      if (method === 'status') {
        status.push(input);
        return efStatus(patch, input.environment ?? 'Development', input.context);
      }
      if (method === 'ef') ef.push(input);
      else other.push(method);
      return method === 'getLogs' ? { lines: [], firstSeq: 1, lastSeq: 0 } : undefined;
    }) as never,
  });
  renderWithProviders(<DatabasePanel projectId="p1" />);
  return { status, ef, other };
}

const card = () => screen.findByRole('region', { name: 'EF Core' });

describe('EF Core card', () => {
  it('lists migrations newest first with applied and pending', async () => {
    setup();
    const list = within(await card()).getByRole('list', { name: 'Migrations' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'AddOrders',
      'AddProducts',
      'Init',
    ]);
    const [orders, products, init] = rows as [HTMLElement, HTMLElement, HTMLElement];
    expect(orders).toHaveTextContent('Pending');
    expect(orders).toHaveTextContent('2026-10-10 00:00');
    expect(products).toHaveTextContent('Applied');
    expect(within(products).queryByRole('button', { name: 'Update to here' })).toBeNull();
    expect(within(init).getByRole('button', { name: 'Update to here' })).toBeInTheDocument();
    expect(within(await card()).getByRole('button', { name: 'Revert all' })).toBeInTheDocument();
    expect(await card()).toHaveTextContent('local tool');
  });

  it('runs list, script and a Development update without asking', async () => {
    const { ef } = setup();
    const c = await card();
    await userEvent.click(within(c).getByRole('button', { name: 'List migrations' }));
    await userEvent.click(within(c).getByRole('button', { name: 'Script SQL' }));
    await userEvent.click(within(c).getByRole('button', { name: 'Update database' }));
    await waitFor(() =>
      expect(ef).toEqual([
        { action: 'list', environment: 'Development' },
        { action: 'script', environment: 'Development' },
        { action: 'update', environment: 'Development' },
      ]),
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks before a Production update, a rollback and remove', async () => {
    const { ef } = setup();
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Environment' }),
      'Production',
    );
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Environment' })).toHaveValue('Production'),
    );
    await userEvent.click(within(await card()).getByRole('button', { name: 'Update database' }));
    const update = await screen.findByRole('alertdialog');
    expect(update).toHaveTextContent('Apply pending migrations to the Production database?');
    expect(ef).toEqual([]);
    await userEvent.click(within(update).getByRole('button', { name: 'Update' }));
    await waitFor(() =>
      expect(ef).toEqual([{ action: 'update', environment: 'Production', confirmed: true }]),
    );

    const init = within(await card()).getByRole('listitem', { name: 'Init' });
    await userEvent.click(within(init).getByRole('button', { name: 'Update to here' }));
    const rollback = await screen.findByRole('alertdialog');
    expect(rollback).toHaveTextContent('Roll the Production database back to Init?');
    await userEvent.click(within(rollback).getByRole('button', { name: 'Roll back' }));
    await waitFor(() =>
      expect(ef.at(-1)).toEqual({
        action: 'update',
        environment: 'Production',
        target: '20261001000000_Init',
        confirmed: true,
      }),
    );

    await userEvent.click(within(await card()).getByRole('button', { name: 'Revert all' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Roll back' }),
    );
    await waitFor(() =>
      expect(ef.at(-1)).toEqual({
        action: 'update',
        environment: 'Production',
        target: '0',
        confirmed: true,
      }),
    );

    await userEvent.click(within(await card()).getByRole('button', { name: 'Remove last' }));
    const remove = await screen.findByRole('alertdialog');
    expect(remove).toHaveTextContent("Remove the last migration's files from the project?");
    await userEvent.click(within(remove).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(ef.at(-1)).toEqual({ action: 'remove', environment: 'Production', confirmed: true }),
    );
  });

  it('validates the migration name while typing', async () => {
    const { ef } = setup();
    await userEvent.click(within(await card()).getByRole('button', { name: 'Add migration…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add migration' });
    const name = within(dialog).getByRole('textbox', { name: 'Migration name' });
    await userEvent.type(name, '1bad');
    expect(within(dialog).getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(dialog).toHaveTextContent('Letters, digits and _; not starting with a digit');
    await userEvent.clear(name);
    await userEvent.type(name, 'AddOrders');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(ef).toEqual([{ action: 'add', environment: 'Development', name: 'AddOrders' }]),
    );
  });

  it('shows a context select with several contexts and passes the pick', async () => {
    const { ef, status } = setup({
      contexts: ['AuthContext', 'ShopDbContext'],
      context: 'AuthContext',
    });
    const select = within(await card()).getByRole('combobox', { name: 'DbContext' });
    expect(select).toHaveValue('AuthContext');
    await userEvent.selectOptions(select, 'ShopDbContext');
    await waitFor(() => expect(status).toContainEqual({ context: 'ShopDbContext' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'EF Core' })).getByRole('combobox', {
          name: 'DbContext',
        }),
      ).toHaveValue('ShopDbContext'),
    );
    await userEvent.click(within(await card()).getByRole('button', { name: 'List migrations' }));
    await waitFor(() =>
      expect(ef).toEqual([
        { action: 'list', environment: 'Development', context: 'ShopDbContext' },
      ]),
    );
  });

  it('shows the install hint without a tool and Restore tools when needed', async () => {
    const { other } = setup({ tool: null });
    const c = await card();
    expect(c).toHaveTextContent('dotnet tool install dotnet-ef');
    expect(within(c).queryByRole('button', { name: 'List migrations' })).toBeNull();
    await userEvent.click(within(c).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(other).toContain('copyInstallCommand'));
  });

  it('runs Restore tools when the last run asked for it', async () => {
    const { ef } = setup({ needsRestore: true });
    await userEvent.click(within(await card()).getByRole('button', { name: 'Restore tools' }));
    await waitFor(() => expect(ef).toEqual([{ action: 'restore', environment: 'Development' }]));
  });

  it('asks to list before showing migrations', async () => {
    setup({ migrations: null });
    expect(await card()).toHaveTextContent('List migrations to see which are applied.');
    expect(within(await card()).queryByRole('list', { name: 'Migrations' })).toBeNull();
  });

  it('titles the log EF Core without Prisma', async () => {
    setup();
    await card();
    expect(await screen.findByLabelText('EF Core log')).toBeInTheDocument();
  });
});

describe('DatabaseCard (EF Core)', () => {
  it('counts pending migrations on the overview card', async () => {
    installMockBridge({ 'tools:invoke': (() => efStatus()) as never });
    renderWithProviders(<DatabaseCard projectId="p1" />);
    const overview = await screen.findByRole('region', { name: 'Database' });
    expect(await within(overview).findByText('1 pending migration')).toHaveClass('text-warn');
  });

  it('says nothing before a list', async () => {
    installMockBridge({ 'tools:invoke': (() => efStatus({ migrations: null })) as never });
    renderWithProviders(<DatabaseCard projectId="p1" />);
    const overview = await screen.findByRole('region', { name: 'Database' });
    await within(overview).findByText('No connection strings');
    expect(within(overview).queryByText(/pending/)).toBeNull();
  });
});
