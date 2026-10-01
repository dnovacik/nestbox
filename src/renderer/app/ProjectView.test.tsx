import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { DetectedProject, ProjectSummary } from '@shared/detected';
import { NestboxError } from '@shared/errors';
import { useUiStore } from '@/state/ui-store';
import { installMockBridge, type MockHandlers } from '@/test/mock-bridge';
import { makeDetected, makeProcess, makeSummary } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { App } from './App';

const ws = makeDetected({ id: 'p1::packages/api', rootId: 'p1', relPath: 'packages/api', name: '@shop/api', path: 'C:\\Dev\\Shop\\packages\\api', git: null });
const root = makeDetected({ id: 'p1', name: 'shop', workspaces: [ws], git: { branch: 'feature/m0', head: null } });

function setup(over: MockHandlers = {}, project: ProjectSummary = makeSummary({ id: 'p1', name: 'shop', detected: root })) {
  const bridge = installMockBridge({
    'app:getInfo': () => ({ version: '0.0.0', platform: 'win32' }),
    'projects:list': () => [project],
    'tools:list': () => [{ id: 'project-info', name: 'Project info', icon: 'info' }],
    'tools:invoke': ({ projectId }) => (projectId === ws.id ? ws : root) satisfies DetectedProject,
    'projects:openInEditor': () => undefined,
    'projects:openTerminal': () => undefined,
    'projects:rename': ({ name }) => makeSummary({ id: 'p1', name, detected: { ...root, name } }),
    'projects:remove': () => undefined,
    'projects:setPinned': ({ pinned }) => ({ ...project, pinned }),
    'projects:refresh': () => project,
    ...over,
  });
  renderWithProviders(<App />);
  return bridge;
}

async function openMenu() {
  await userEvent.click(await screen.findByRole('button', { name: 'Project actions' }));
}

describe('project header', () => {
  it('shows name, path, package manager and branch', async () => {
    setup();
    const main = await screen.findByRole('main');
    const heading = await within(main).findByRole('heading', { name: 'shop' });
    expect(heading).toHaveTextContent(/^shop$/);
    expect(within(main).getByText('C:\\Dev\\Shop')).toBeInTheDocument();
    // 'pnpm' also appears on the Overview card once it loads
    expect(within(main).getAllByText('pnpm').length).toBeGreaterThan(0);
    expect(within(main).getByText('feature/m0')).toBeInTheDocument();
  });

  it('opens the editor and terminal for the selected project', async () => {
    const bridge = setup();
    await userEvent.click(await screen.findByRole('button', { name: /open in vs code/i }));
    await userEvent.click(screen.getByRole('button', { name: /open terminal here/i }));
    await waitFor(() => expect(bridge.callsTo('projects:openTerminal')).toEqual([{ id: 'p1' }]));
    expect(bridge.callsTo('projects:openInEditor')).toEqual([{ id: 'p1' }]);
  });

  it('shows a toast when the folder vanished', async () => {
    setup({
      'projects:openInEditor': () => {
        throw new NestboxError('NOT_FOUND', 'The project folder no longer exists');
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: /open in vs code/i }));
    expect(await screen.findByText('The project folder no longer exists')).toBeInTheDocument();
  });

  it('renames inline: Enter saves the trimmed name, Escape cancels', async () => {
    const bridge = setup();
    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const input = await screen.findByRole('textbox', { name: 'Project name' });
    await userEvent.clear(input);
    await userEvent.type(input, '  Shop Backend  {Enter}');
    await waitFor(() => expect(bridge.callsTo('projects:rename')).toEqual([{ id: 'p1', name: 'Shop Backend' }]));

    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Project name' }), 'x{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Project name' })).toBeNull();
    expect(bridge.callsTo('projects:rename')).toHaveLength(1);
  });

  it('removes only after confirming', async () => {
    const bridge = setup();
    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/folder on disk is not touched/i)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(bridge.callsTo('projects:remove')).toEqual([]);

    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(bridge.callsTo('projects:remove')).toEqual([{ id: 'p1' }]));
  });

  it('offers Stop all only while the project or a workspace has live processes', async () => {
    const bridge = setup({
      'processes:list': () => [makeProcess({ projectId: 'p1::packages/api', state: 'running' })],
      'processes:stopAll': () => undefined,
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Stop all' }));
    await waitFor(() => expect(bridge.callsTo('processes:stopAll')).toEqual([{ projectId: 'p1' }]));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('has no Stop all without live processes', async () => {
    setup({ 'processes:list': () => [makeProcess({ state: 'crashed' })] });
    await screen.findByRole('button', { name: 'Project actions' });
    expect(screen.queryByRole('button', { name: 'Stop all' })).toBeNull();
  });

  it('says how many scripts a remove will stop', async () => {
    setup({
      'processes:list': () => [makeProcess(), makeProcess({ projectId: 'p1::packages/api', script: 'api' })],
    });
    await screen.findByRole('button', { name: 'Stop all' });
    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/2 running scripts will be stopped\./)).toBeInTheDocument();
  });

  it('pins from the menu', async () => {
    const bridge = setup();
    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Pin' }));
    await waitFor(() => expect(bridge.callsTo('projects:setPinned')).toEqual([{ id: 'p1', pinned: true }]));
  });

  it('offers only Refresh for a workspace package', async () => {
    useUiStore.getState().select('p1::packages/api');
    const bridge = setup();
    const main = await screen.findByRole('main');
    const heading = await within(main).findByRole('heading', { name: 'shop / @shop/api' });
    expect(heading).toHaveTextContent('shop');
    expect(heading).toHaveTextContent('@shop/api');
    await openMenu();
    expect(await screen.findByRole('menuitem', { name: 'Refresh' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Remove' })).toBeNull();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Refresh' }));
    await waitFor(() => expect(bridge.callsTo('projects:refresh')).toEqual([{ id: 'p1::packages/api' }]));
  });
});

describe('tabs and tools', () => {
  it('shows the Overview tab with the Project info card first', async () => {
    setup();
    const tab = await screen.findByRole('tab', { name: 'Overview' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    const card = await screen.findByRole('region', { name: 'Project info' });
    expect(within(card).getByText('pnpm')).toBeInTheDocument();
    expect(within(card).getByText('2 scripts')).toBeInTheDocument();
  });

  it('switches to the Project info panel', async () => {
    setup();
    await userEvent.click(await screen.findByRole('tab', { name: 'Project info' }));
    expect(await screen.findByRole('heading', { name: 'Scripts' })).toBeInTheDocument();
    expect(screen.getByText('vite build')).toBeInTheDocument();
    expect(screen.getByText('.env.example')).toBeInTheDocument();
    expect(useUiStore.getState().activeTab['p1']).toBe('project-info');
  });

  it('hides tools and disables actions for a missing folder', async () => {
    setup({}, makeSummary({ id: 'p1', name: 'shop', detected: { ...root, missing: true, workspaces: [] } }));
    expect(await screen.findByText(/folder no longer exists/i)).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('button', { name: /open in vs code/i })).toBeDisabled();
  });
});
