import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ProjectSummary } from '@shared/detected';
import { NestboxError } from '@shared/errors';
import { installMockBridge } from '@/test/mock-bridge';
import { makeSummary } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { App } from './App';

const baseHandlers = {
  'app:getInfo': () => ({ version: '0.0.0', platform: 'win32' as const }),
  'tools:list': () => [],
};

describe('App shell', () => {
  it('shows the empty state and a zero count without projects', async () => {
    installMockBridge({ ...baseHandlers, 'projects:list': () => [] });
    renderWithProviders(<App />);
    expect(await screen.findByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
    expect(screen.getByText('0 projects')).toBeInTheDocument();
    expect(await screen.findByText('v0.0.0')).toBeInTheDocument();
  });

  it('keeps an empty main landmark while projects load', async () => {
    let release: (value: ProjectSummary[]) => void = () => {};
    const pending = new Promise<ProjectSummary[]>((resolve) => {
      release = resolve;
    });
    installMockBridge({ ...baseHandlers, 'projects:list': () => pending });
    renderWithProviders(<App />);
    const main = screen.getByRole('main');
    expect(main).toBeEmptyDOMElement();
    expect(screen.queryByRole('heading', { name: 'No projects yet' })).toBeNull();
    release([]);
    expect(await within(main).findByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
  });

  it('adds a project from the empty state and selects it', async () => {
    let projects: ProjectSummary[] = [];
    installMockBridge({
      ...baseHandlers,
      'projects:list': () => projects,
      'dialog:pickFolder': () => 'C:\\Dev\\Shop',
      'projects:add': () => {
        projects = [makeSummary()];
        return projects[0] as ProjectSummary;
      },
    });
    renderWithProviders(<App />);
    await screen.findByRole('heading', { name: 'No projects yet' });
    const main = screen.getByRole('main');
    await userEvent.click(within(main).getByRole('button', { name: /add project/i }));
    expect(await within(main).findByRole('heading', { name: 'shop' })).toBeInTheDocument();
    expect(within(screen.getByRole('complementary', { name: 'Projects' })).getByRole('button', { name: 'shop' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('1 project')).toBeInTheDocument();
  });

  it('shows a toast when the folder is already added', async () => {
    installMockBridge({
      ...baseHandlers,
      'projects:list': () => [],
      'dialog:pickFolder': () => 'c:\\dev\\shop\\',
      'projects:add': () => {
        throw new NestboxError('CONFLICT', 'This folder is already added as "shop"');
      },
    });
    renderWithProviders(<App />);
    await screen.findByRole('heading', { name: 'No projects yet' });
    const main = screen.getByRole('main');
    await userEvent.click(within(main).getByRole('button', { name: /add project/i }));
    expect(await screen.findByText('This folder is already added as "shop"')).toBeInTheDocument();
  });

  it('refetches projects when main reports a change', async () => {
    let projects: ProjectSummary[] = [];
    const bridge = installMockBridge({ ...baseHandlers, 'projects:list': () => projects });
    renderWithProviders(<App />);
    await screen.findByRole('heading', { name: 'No projects yet' });
    projects = [makeSummary()];
    bridge.emit('projects:changed');
    await waitFor(() => expect(screen.getByText('1 project')).toBeInTheDocument());
  });
});
