import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { NestboxError } from '@shared/errors';
import { useUiStore } from '@/state/ui-store';
import { makeProcess } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { ScriptList } from './ScriptList';
import { installScriptsBridge } from './test-bridge';

const scripts = [
  { name: 'dev', command: 'vite', autoRestart: false },
  { name: 'api', command: 'nest start --watch', autoRestart: true },
];

describe('ScriptList', () => {
  it('lists scripts with their commands and a Start button when idle', async () => {
    installScriptsBridge({ scripts });
    renderWithProviders(<ScriptList projectId="p1" />);
    expect(await screen.findByText('nest start --watch')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start dev' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop dev' })).toBeNull();
  });

  it('starts a script and shows it in the active pane', async () => {
    const { callsTo } = installScriptsBridge({ scripts });
    renderWithProviders(<ScriptList projectId="p1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Start dev' }));
    await waitFor(() => expect(callsTo('start')).toEqual([{ script: 'dev' }]));
    expect(useUiStore.getState().scriptPanes['p1']?.scripts).toEqual(['dev']);
  });

  it('offers Stop and Restart while live, with a starting badge', async () => {
    const { callsTo } = installScriptsBridge({ scripts, processes: [makeProcess({ script: 'dev', state: 'starting' })] });
    renderWithProviders(<ScriptList projectId="p1" />);
    expect(await screen.findByText('starting')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Restart dev' }));
    await userEvent.click(screen.getByRole('button', { name: 'Stop dev' }));
    await waitFor(() => expect(callsTo('stop')).toEqual([{ script: 'dev' }]));
    expect(callsTo('restart')).toEqual([{ script: 'dev' }]);
  });

  it('shows a crash with its exit code, last line and count', async () => {
    installScriptsBridge({
      scripts,
      processes: [
        makeProcess({ script: 'dev', state: 'crashed', crashCount: 3, exit: { code: 1, signal: null, lastLine: 'Error: boom' } }),
      ],
    });
    renderWithProviders(<ScriptList projectId="p1" />);
    expect(await screen.findByText('exit 1 · Error: boom')).toBeInTheDocument();
    expect(screen.getByText('3 crashes')).toBeInTheDocument();
  });

  it('shows auto-restart progress and giving up', async () => {
    installScriptsBridge({
      scripts,
      processes: [
        makeProcess({ script: 'dev', state: 'crashed', crashCount: 1, nextRestartAt: 5, exit: { code: 1, signal: null, lastLine: null } }),
        makeProcess({ script: 'api', state: 'crashed', crashCount: 5, gaveUp: true, exit: { code: 1, signal: null, lastLine: null } }),
      ],
    });
    renderWithProviders(<ScriptList projectId="p1" />);
    expect(await screen.findByText('restarting…')).toBeInTheDocument();
    expect(screen.getByText('gave up after 5 crashes')).toBeInTheDocument();
  });

  it('toggles auto-restart', async () => {
    const { callsTo } = installScriptsBridge({ scripts });
    renderWithProviders(<ScriptList projectId="p1" />);
    const toggle = await screen.findByRole('switch', { name: 'Auto-restart api' });
    expect(toggle).toBeChecked();
    await userEvent.click(screen.getByRole('switch', { name: 'Auto-restart dev' }));
    await waitFor(() => expect(callsTo('setAutoRestart')).toEqual([{ script: 'dev', enabled: true }]));
  });

  it('shows the output when the name is clicked', async () => {
    installScriptsBridge({ scripts });
    renderWithProviders(<ScriptList projectId="p1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'api' }));
    expect(useUiStore.getState().scriptPanes['p1']?.scripts).toEqual(['api']);
  });

  it('toasts a failed start', async () => {
    installScriptsBridge({
      scripts,
      methods: {
        start: () => {
          throw new NestboxError('CONFLICT', 'The script is already running');
        },
      },
    });
    renderWithProviders(<ScriptList projectId="p1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Start dev' }));
    expect(await screen.findByText('The script is already running')).toBeInTheDocument();
  });

  it('shows an amber Node badge with the version warning', async () => {
    installScriptsBridge({
      scripts,
      processes: [makeProcess({ script: 'dev', warning: "Node v20.11.1 doesn't match 18 (.nvmrc)" })],
    });
    renderWithProviders(<ScriptList projectId="p1" />);
    const badge = await screen.findByLabelText("Version warning: Node v20.11.1 doesn't match 18 (.nvmrc)");
    expect(badge).toHaveTextContent('Node');
    expect(badge).toHaveAttribute('title', "Node v20.11.1 doesn't match 18 (.nvmrc)");
  });
});
