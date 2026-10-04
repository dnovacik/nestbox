import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useUiStore } from '@/state/ui-store';
import { installMockBridge } from '@/test/mock-bridge';
import { makeDetected, makeProcess, makeSummary } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { useProcessesChangedSubscription } from '@/lib/queries';
import { Sidebar } from './Sidebar';

const ws = makeDetected({ id: 'p1::packages/api', rootId: 'p1', relPath: 'packages/api', name: '@mono/api' });
const mono = makeSummary({ id: 'p1', name: 'mono', pinned: true, detected: makeDetected({ id: 'p1', name: 'mono', workspaces: [ws] }) });
const shop = makeSummary({ id: 'p2', name: 'shop', detected: makeDetected({ id: 'p2', rootId: 'p2', name: 'shop' }) });
const gone = makeSummary({ id: 'p3', name: 'gone', detected: makeDetected({ id: 'p3', rootId: 'p3', name: 'gone', missing: true }) });

function renderSidebar(selectedId: string | null = null) {
  installMockBridge({});
  return renderWithProviders(<Sidebar projects={[mono, shop, gone]} selectedId={selectedId} />);
}

describe('Sidebar', () => {
  it('shows a Pinned section only for pinned projects', () => {
    renderSidebar();
    const pinned = screen.getByRole('region', { name: 'Pinned' });
    expect(within(pinned).getByRole('button', { name: 'mono' })).toBeInTheDocument();
    const all = screen.getByRole('region', { name: 'All projects' });
    expect(within(all).getByText('3')).toBeInTheDocument();
    expect(within(all).queryByRole('button', { name: 'mono' })).toBeNull();
  });

  it('has no Pinned section when nothing is pinned', () => {
    installMockBridge({});
    renderWithProviders(<Sidebar projects={[shop]} selectedId={null} />);
    expect(screen.queryByRole('region', { name: 'Pinned' })).toBeNull();
  });

  it('filters by project or workspace name', async () => {
    renderSidebar();
    await userEvent.type(screen.getByRole('textbox', { name: 'Filter projects' }), 'api');
    expect(screen.getByRole('button', { name: 'mono' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'shop' })).toBeNull();
  });

  it('nests workspaces, selects them and collapses the group', async () => {
    renderSidebar();
    await userEvent.click(screen.getByRole('button', { name: '@mono/api' }));
    expect(useUiStore.getState().selectedProjectId).toBe('p1::packages/api');
    await userEvent.click(screen.getByRole('button', { name: 'Collapse mono' }));
    expect(screen.queryByRole('button', { name: '@mono/api' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Expand mono' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('marks the selected project and missing folders', () => {
    renderSidebar('p2');
    expect(screen.getByRole('button', { name: 'shop' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /^gone/ })).toHaveTextContent('missing');
  });

  it('shows the filtered count and a no-match hint that clears the filter', async () => {
    renderSidebar();
    const all = screen.getByRole('region', { name: 'All projects' });
    await userEvent.type(screen.getByRole('textbox', { name: 'Filter projects' }), 'sho');
    expect(within(all).getByText('1 of 3')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Filter projects' }), 'zzz');
    expect(screen.getByText('No projects match “shozzz”.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(screen.getByRole('textbox', { name: 'Filter projects' })).toHaveValue('');
    expect(within(all).getByText('3')).toBeInTheDocument();
  });

  describe('process state dots', () => {
    const dotOf = (name: string) => screen.getByRole('button', { name }).querySelector('[data-state]');

    it('shows each row\'s own state, and a collapsed root includes its workspaces', async () => {
      installMockBridge({
        'processes:list': () => [
          makeProcess({ projectId: 'p2', state: 'running' }),
          makeProcess({ projectId: 'p1::packages/api', state: 'crashed' }),
        ],
      });
      renderWithProviders(<Sidebar projects={[mono, shop]} selectedId={null} />);
      await waitFor(() => expect(dotOf('shop')).toHaveAttribute('data-state', 'running'));
      expect(screen.getByRole('button', { name: 'shop' })).toHaveAttribute('title', 'shop: running');
      expect(dotOf('mono')).toHaveAttribute('data-state', 'idle');
      expect(dotOf('@mono/api')).toHaveAttribute('data-state', 'crashed');
      await userEvent.click(screen.getByRole('button', { name: 'Collapse mono' }));
      expect(dotOf('mono')).toHaveAttribute('data-state', 'crashed');
    });

    it('refetches on processes:changed', async () => {
      let state: 'starting' | 'running' = 'starting';
      const bridge = installMockBridge({ 'processes:list': () => [makeProcess({ projectId: 'p2', state })] });
      renderWithProviders(
        <>
          <ProcessesSubscriber />
          <Sidebar projects={[shop]} selectedId={null} />
        </>,
      );
      await waitFor(() => expect(dotOf('shop')).toHaveAttribute('data-state', 'starting'));
      state = 'running';
      bridge.emit('processes:changed');
      await waitFor(() => expect(dotOf('shop')).toHaveAttribute('data-state', 'running'));
    });
  });
});

function ProcessesSubscriber() {
  useProcessesChangedSubscription();
  return null;
}
