import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useUiStore } from '@/state/ui-store';
import { makeDetected, makeSummary } from '@/test/fixtures';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { CommandPalette } from './CommandPalette';

type Invoke = { toolId: string; projectId: string; method: string; input: unknown };

function setup() {
  const shop = makeSummary({ detected: makeDetected({ packageJson: { scripts: { serve: 'node server.js', build: 'tsc' } } }) });
  const blog = makeSummary({ id: 'p2', name: 'blog' });
  const bridge = installMockBridge({
    'projects:list': () => [shop, blog],
    'processes:list': () => [],
    'tools:list': () => [{ id: 'scripts', name: 'Scripts', icon: 'play' }],
    'tools:invoke': ((call: Invoke) => {
      if (call.method === 'list') return { scripts: [], runGroups: [], packages: [] };
      return undefined;
    }) as never,
  });
  useUiStore.setState({ selectedProjectId: 'p1' });
  renderWithProviders(
    <>
      <button type="button">Before</button>
      <CommandPalette />
    </>,
  );
  const invokes = () => (bridge.callsTo('tools:invoke') as Invoke[]).filter((c) => c.method !== 'list');
  return { invokes };
}

describe('CommandPalette', () => {
  it('opens with Ctrl+K, filters, and runs a script, showing its log', async () => {
    const { invokes } = setup();
    await userEvent.keyboard('{Control>}k{/Control}');
    const input = await screen.findByRole('combobox', { name: 'Command palette' });
    await userEvent.type(input, 'serve');
    expect(await screen.findByRole('option', { name: /Run serve in shop/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Run build in shop/ })).toBeNull();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(invokes()).toEqual([{ toolId: 'scripts', projectId: 'p1', method: 'start', input: { script: 'serve' } }]));
    await waitFor(() => expect(useUiStore.getState().activeTab['p1']).toBe('scripts'));
    expect(useUiStore.getState().scriptPanes['p1']?.scripts).toEqual(['serve']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('selects a project', async () => {
    setup();
    await userEvent.keyboard('{Control>}k{/Control}');
    await userEvent.type(await screen.findByRole('combobox', { name: 'Command palette' }), 'blog');
    await userEvent.click(await screen.findByRole('option', { name: /^blog/ }));
    expect(useUiStore.getState().selectedProjectId).toBe('p2');
  });

  it('opens Claude in a terminal', async () => {
    const { invokes } = setup();
    await userEvent.keyboard('{Control>}k{/Control}');
    await userEvent.type(await screen.findByRole('combobox', { name: 'Command palette' }), 'claude: open shop');
    await userEvent.click(await screen.findByRole('option', { name: 'Claude: open shop' }));
    await waitFor(() => expect(invokes()).toEqual([{ toolId: 'claude', projectId: 'p1', method: 'open', input: {} }]));
  });

  it('closes with Escape and returns focus', async () => {
    setup();
    const before = screen.getByRole('button', { name: 'Before' });
    before.focus();
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(before).toHaveFocus());
  });
});
