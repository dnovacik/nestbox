import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useUiStore } from '@/state/ui-store';
import { installMockBridge } from '@/test/mock-bridge';
import { makeDetected, makeSummary } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
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
    expect(screen.getByRole('button', { name: /gone/ })).toHaveTextContent('missing');
  });
});
