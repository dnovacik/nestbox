import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { DbStatus } from '@shared/tools/database/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { useUiStore } from '@/state/ui-store';
import { DatabaseCard } from './OverviewCard';
import { dbStatus } from './fixtures';

async function renderCard(status: DbStatus) {
  const bridge = installMockBridge({ 'tools:invoke': (() => status) as never, 'app:openExternal': (() => undefined) as never });
  renderWithProviders(<DatabaseCard projectId="p1" />);
  return { card: await screen.findByRole('region', { name: 'Database' }), bridge };
}

describe('DatabaseCard', () => {
  it('shows where the URL points and that it answers', async () => {
    const { card } = await renderCard(dbStatus());
    expect(await within(card).findByText('postgresql · localhost:5432/shop')).toBeInTheDocument();
    expect(within(card).getByText('Reachable')).toHaveClass('text-ok');
  });

  it('shows a refused server with its reason', async () => {
    const { card } = await renderCard(dbStatus({ reach: { result: 'refused', reason: 'ECONNREFUSED' } }));
    expect(await within(card).findByText('Refused')).toHaveAttribute('title', 'ECONNREFUSED');
  });

  it('describes SQLite by its file', async () => {
    const target = { provider: 'sqlite', host: null, port: null, database: 'dev.db', file: '/p/prisma/dev.db', source: '.env' as const };
    const { card } = await renderCard(dbStatus({ url: { state: 'set', target }, reach: { result: 'missing-file', reason: 'x' } }));
    expect(await within(card).findByText('SQLite · dev.db')).toBeInTheDocument();
    expect(within(card).getByText('File missing')).toBeInTheDocument();
  });

  it('says when no URL is set, and mentions prisma.config.ts', async () => {
    const { card } = await renderCard(dbStatus({ url: { state: 'missing', configTs: true }, reach: null }));
    expect(await within(card).findByText(/No DATABASE_URL in .env. prisma.config.ts may set it/)).toBeInTheDocument();
  });

  it('links to a running Studio and opens the Database tab', async () => {
    const { card, bridge } = await renderCard(dbStatus({ running: { command: null, studio: { port: 5556 } } }));
    await userEvent.click(await within(card).findByRole('button', { name: 'Studio on localhost:5556' }));
    expect(bridge.callsTo('app:openExternal')).toEqual([{ url: 'http://localhost:5556' }]);
    await userEvent.click(within(card).getByRole('button', { name: 'Open Database' }));
    expect(useUiStore.getState().activeTab.p1).toBe('database');
  });
});
