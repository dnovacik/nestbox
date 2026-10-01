import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { NestboxError } from '@shared/errors';
import type { EnvMatrix } from '@shared/tools/env/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import EnvPanel from './Panel';

const SECRET = 'postgres://u:s3cr3t@h/db';

const MATRIX: EnvMatrix = {
  files: [
    { name: '.env.example', version: 'v-ex', readOnly: false, entries: 3, duplicates: [] },
    { name: '.env', version: 'v-env', readOnly: false, entries: 2, duplicates: [] },
    { name: '.env.staging', version: 'v-st', readOnly: true, entries: 1, duplicates: [] },
  ],
  keys: [
    { key: 'PORT', cells: { '.env.example': 'empty', '.env': 'set', '.env.staging': 'set' }, missing: false, undocumented: false },
    { key: 'DATABASE_URL', cells: { '.env.example': 'empty', '.env': 'set', '.env.staging': 'absent' }, missing: false, undocumented: false },
    { key: 'REDIS_URL', cells: { '.env.example': 'set', '.env': 'absent', '.env.staging': 'absent' }, missing: true, undocumented: false },
  ],
  example: '.env.example',
  profiles: [{ name: 'staging', file: '.env.staging', active: false }],
};

type Call = { method: string; input: Record<string, unknown> };

function setup(over: Partial<Record<string, (input: Record<string, unknown>) => unknown>> = {}, matrix: EnvMatrix = MATRIX) {
  const calls: Call[] = [];
  const bridge = installMockBridge({
    'tools:invoke': (({ method, input }: Call) => {
      calls.push({ method, input });
      const handler = over[method];
      if (handler) return handler(input);
      if (method === 'matrix') return matrix;
      if (method === 'reveal') return { value: input['key'] === 'DATABASE_URL' ? SECRET : 'redis://localhost:6379' };
      if (method === 'copy') return {};
      if (['setValue', 'addKey', 'removeKey'].includes(method)) return { version: 'v2' };
      if (method === 'switchProfile') return {};
      throw new Error(`unexpected ${method}`);
    }) as never,
  });
  renderWithProviders(<EnvPanel projectId="p1" />);
  return { bridge, calls, of: (m: string) => calls.filter((c) => c.method === m).map((c) => c.input) };
}

const table = () => screen.findByRole('table', { name: 'Env files' });

describe('EnvPanel', () => {
  it('shows keys by file with values masked, the example first and flags', async () => {
    setup();
    const t = await table();
    expect(within(t).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Key', '.env.example', '.env', '.env.staging']);
    const row = within(t).getByRole('row', { name: /DATABASE_URL/ });
    expect(within(row).getAllByText('••••••')).toHaveLength(1);
    expect(within(t).getByRole('row', { name: /REDIS_URL/ })).toHaveTextContent('missing in .env');
    expect(t.textContent).not.toContain('s3cr3t');
  });

  it('reveals one value until the cell loses focus', async () => {
    setup();
    await table();
    await userEvent.click(screen.getByRole('button', { name: 'Reveal DATABASE_URL in .env' }));
    expect(await screen.findByText(SECRET)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('heading', { name: 'Env files' }));
    await waitFor(() => expect(screen.queryByText(SECRET)).toBeNull());
  });

  it('copies without revealing', async () => {
    const { of } = setup();
    await table();
    await userEvent.click(screen.getByRole('button', { name: 'Copy DATABASE_URL from .env' }));
    await waitFor(() => expect(of('copy')).toEqual([{ file: '.env', key: 'DATABASE_URL' }]));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('s3cr3t');
  });

  it('edits a value with the version it was based on', async () => {
    const { of } = setup();
    await table();
    await userEvent.click(screen.getByRole('button', { name: 'Edit PORT in .env' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit PORT in .env' });
    const input = await within(dialog).findByRole('textbox', { name: 'Value' });
    await waitFor(() => expect(input).toHaveValue('redis://localhost:6379'));
    await userEvent.clear(input);
    await userEvent.type(input, '4000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(of('setValue')).toEqual([{ file: '.env', key: 'PORT', value: '4000', version: 'v-env' }]));
  });

  it('closes the edit dialog when the current value cannot be loaded, so nothing is overwritten', async () => {
    const { of } = setup({
      reveal: () => {
        throw new NestboxError('NOT_FOUND', 'That key is not in this file');
      },
    });
    await table();
    await userEvent.click(screen.getByRole('button', { name: 'Edit PORT in .env' }));
    expect(await screen.findByText('That key is not in this file')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(of('setValue')).toEqual([]);
  });

  it('says so when the file changed on disk', async () => {
    setup({
      setValue: () => {
        throw new NestboxError('CONFLICT', 'The file changed on disk. Reload and try again.');
      },
    });
    await table();
    await userEvent.click(screen.getByRole('button', { name: 'Edit PORT in .env' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('The file changed on disk. It has been reloaded.')).toBeInTheDocument();
  });

  it('adds a missing key, copying the value from the example', async () => {
    const { of } = setup();
    await table();
    await userEvent.click(screen.getByRole('button', { name: 'Add REDIS_URL to .env' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add REDIS_URL to .env' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Copy from .env.example' }));
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: 'Value' })).toHaveValue('redis://localhost:6379'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(of('addKey')).toEqual([{ file: '.env', key: 'REDIS_URL', value: 'redis://localhost:6379', version: 'v-env' }]),
    );
  });

  it('removes a key after a confirm', async () => {
    const { of } = setup();
    await table();
    await userEvent.click(screen.getByRole('button', { name: 'Remove DATABASE_URL from .env' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Remove DATABASE_URL from .env?');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(of('removeKey')).toEqual([{ file: '.env', key: 'DATABASE_URL', version: 'v-env' }]));
  });

  it('offers no edits for a read-only (symlinked) file', async () => {
    setup();
    await table();
    expect(screen.queryByRole('button', { name: 'Edit PORT in .env.staging' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reveal PORT in .env.staging' })).toBeInTheDocument();
  });

  it('filters to flagged keys', async () => {
    setup();
    const t = await table();
    await userEvent.click(screen.getByRole('switch', { name: 'Flagged only' }));
    await waitFor(() => expect(within(t).getAllByRole('row')).toHaveLength(2));
    expect(t).toHaveTextContent('REDIS_URL');
  });

  it('switches profile after a confirm that warns about an unsaved .env', async () => {
    const { of } = setup();
    await table();
    await userEvent.click(screen.getByRole('button', { name: 'Switch to staging' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Your current .env matches no profile. It will be kept only as .env.backup.');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Switch' }));
    await waitFor(() => expect(of('switchProfile')).toEqual([{ file: '.env.staging', envVersion: 'v-env' }]));
  });

  it('offers no profile switch when .env is read-only', async () => {
    setup({}, { ...MATRIX, files: MATRIX.files.map((f) => (f.name === '.env' ? { ...f, readOnly: true } : f)) });
    await table();
    expect(screen.queryByRole('button', { name: 'Switch to staging' })).toBeNull();
  });

  it('reloads when the tool reports a change', async () => {
    const { bridge, of } = setup();
    await table();
    act(() => bridge.emit('tools:event', { toolId: 'env', projectId: 'p1', event: 'changed', payload: undefined }));
    await waitFor(() => expect(of('matrix')).toHaveLength(2));
  });

  it('says when there are no env files', async () => {
    setup({}, { files: [], keys: [], example: null, profiles: [] });
    expect(await screen.findByText('No .env files in this folder.')).toBeInTheDocument();
  });
});
