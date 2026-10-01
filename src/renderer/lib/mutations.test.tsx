import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NestboxError } from '@shared/errors';
import type { InvokeChannel } from '@shared/ipc-names';
import { makeSummary } from '@/test/fixtures';
import { installMockBridge, type MockHandlers } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { useOpenInEditor, useOpenTerminal, useRefreshProject, useRenameProject, useSetPinned } from './queries';

function Buttons() {
  const rename = useRenameProject();
  const pin = useSetPinned();
  const refresh = useRefreshProject();
  const editor = useOpenInEditor();
  const terminal = useOpenTerminal();
  return (
    <>
      <button type="button" onClick={() => rename.mutate({ id: 'p1', name: 'new' })}>rename</button>
      <button type="button" onClick={() => pin.mutate({ id: 'p1', pinned: true })}>pin</button>
      <button type="button" onClick={() => refresh.mutate('p1')}>refresh</button>
      <button type="button" onClick={() => editor.mutate('p1')}>editor</button>
      <button type="button" onClick={() => terminal.mutate('p1')}>terminal</button>
    </>
  );
}

const cases: [string, InvokeChannel, unknown][] = [
  ['rename', 'projects:rename', { id: 'p1', name: 'new' }],
  ['pin', 'projects:setPinned', { id: 'p1', pinned: true }],
  ['refresh', 'projects:refresh', { id: 'p1' }],
  ['editor', 'projects:openInEditor', { id: 'p1' }],
  ['terminal', 'projects:openTerminal', { id: 'p1' }],
];

describe('project mutation hooks', () => {
  it.each(cases)('%s calls %s with its input', async (button, channel, input) => {
    const ok: MockHandlers = {
      'projects:rename': () => makeSummary(),
      'projects:setPinned': () => makeSummary(),
      'projects:refresh': () => makeSummary(),
      'projects:openInEditor': () => undefined,
      'projects:openTerminal': () => undefined,
    };
    const bridge = installMockBridge(ok);
    renderWithProviders(<Buttons />);
    await userEvent.click(screen.getByRole('button', { name: button }));
    await waitFor(() => expect(bridge.callsTo(channel)).toEqual([input]));
  });

  it.each(cases)('%s shows its error as a toast', async (button, channel) => {
    installMockBridge({
      [channel]: () => {
        throw new NestboxError('NOT_FOUND', `failed: ${button}`);
      },
    } as MockHandlers);
    renderWithProviders(<Buttons />);
    await userEvent.click(screen.getByRole('button', { name: button }));
    expect(await screen.findByText(`failed: ${button}`)).toBeInTheDocument();
  });

  it('refresh invalidates projects, tool lists and tool data', async () => {
    installMockBridge({ 'projects:refresh': () => makeSummary() });
    const { client } = renderWithProviders(<Buttons />);
    const spy = vi.spyOn(client, 'invalidateQueries');
    await userEvent.click(screen.getByRole('button', { name: 'refresh' }));
    await waitFor(() =>
      expect(spy.mock.calls.map(([f]) => f?.queryKey)).toEqual(expect.arrayContaining([['projects'], ['tools'], ['tool']])),
    );
  });

  it.each(['editor', 'terminal'])('%s re-reads projects after a failure', async (button) => {
    installMockBridge({
      'projects:openInEditor': () => {
        throw new NestboxError('NOT_FOUND', 'The project folder no longer exists');
      },
      'projects:openTerminal': () => {
        throw new NestboxError('NOT_FOUND', 'The project folder no longer exists');
      },
    });
    const { client } = renderWithProviders(<Buttons />);
    const spy = vi.spyOn(client, 'invalidateQueries');
    await userEvent.click(screen.getByRole('button', { name: button }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['projects'] }));
  });
});
