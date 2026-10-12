import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ConfigMatrix, EnvMatrix } from '@shared/tools/env/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import EnvPanel from './Panel';

const SECRET = 'Server=db;Password=s3cr3t';
const file = (
  name: string,
  over: Partial<ConfigMatrix['files'][number]> = {},
): ConfigMatrix['files'][number] => ({
  name,
  version: `v-${name}`,
  readOnly: false,
  tooLarge: false,
  invalid: false,
  entries: 2,
  caseDuplicates: [],
  ...over,
});

const CONFIG: ConfigMatrix = {
  dotnet: true,
  files: [file('appsettings.json'), file('appsettings.Development.json')],
  keys: [
    {
      key: 'Logging:LogLevel:Default',
      cells: { 'appsettings.json': 'set', 'appsettings.Development.json': 'set' },
      overridden: true,
      envOnly: false,
    },
    {
      key: 'ConnectionStrings:Default',
      cells: { 'appsettings.json': 'set', 'appsettings.Development.json': 'absent' },
      overridden: false,
      envOnly: false,
    },
    {
      key: 'Retries',
      cells: { 'appsettings.json': 'absent', 'appsettings.Development.json': 'set' },
      overridden: false,
      envOnly: true,
    },
  ],
  profiles: [
    {
      name: 'http',
      environment: 'Development',
      file: 'appsettings.Development.json',
      exists: true,
    },
    { name: 'prod', environment: 'Production', file: 'appsettings.Production.json', exists: false },
  ],
  truncated: false,
};
const NO_ENV: EnvMatrix = { files: [], keys: [], example: null, profiles: [] };

type Call = { method: string; input: Record<string, unknown> };

function setup(config: ConfigMatrix = CONFIG, env: EnvMatrix = NO_ENV) {
  const calls: Call[] = [];
  installMockBridge({
    'tools:invoke': (({ method, input }: Call) => {
      calls.push({ method, input });
      if (method === 'matrix') return env;
      if (method === 'configMatrix') return config;
      if (method === 'codeKeys') return { keys: [], files: 0, truncated: false };
      if (method === 'configReveal') {
        return input['key'] === 'Retries'
          ? { value: '3', type: 'number' }
          : { value: SECRET, type: 'string' };
      }
      if (['configSetValue', 'configAddKey', 'configRemoveKey'].includes(method))
        return { version: 'v2' };
      if (method === 'createConfigFile')
        return { version: 'v1', file: 'appsettings.Production.json' };
      if (method === 'readConfigRaw') return { text: '{ "A": 1 }', version: 'raw-v1' };
      throw new Error(`unexpected ${method}`);
    }) as never,
  });
  renderWithProviders(<EnvPanel projectId="p1" />);
  return { of: (m: string) => calls.filter((c) => c.method === m).map((c) => c.input) };
}

const table = () => screen.findByRole('table', { name: 'Settings files' });

describe('Configuration section', () => {
  it('comes first in a .NET package, without a .env section when there are no .env files', async () => {
    setup();
    const t = await table();
    expect(
      within(t)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Key', 'appsettings.json', 'appsettings.Development.json']);
    expect(within(t).getByRole('row', { name: /Logging:LogLevel:Default/ })).toHaveTextContent(
      'overridden',
    );
    expect(within(t).getByRole('row', { name: /Retries/ })).toHaveTextContent('env only');
    expect(screen.queryByText('No .env files in this folder.')).toBeNull();
    expect(screen.queryByRole('table', { name: 'Env files' })).toBeNull();
    expect(t.textContent).not.toContain('s3cr3t');
  });

  it('shows the .env section after it when the package has .env files', async () => {
    setup(CONFIG, {
      files: [{ name: '.env', version: 'v', readOnly: false, entries: 1, duplicates: [] }],
      keys: [{ key: 'A', cells: { '.env': 'set' }, missing: false, undocumented: false }],
      example: null,
      profiles: [],
    });
    await table();
    const sections = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(sections.indexOf('Configuration')).toBeLessThan(sections.indexOf('Env'));
  });

  it('is left out of a Node package without settings files', async () => {
    setup(
      { ...CONFIG, dotnet: false, files: [], keys: [], profiles: [] },
      { files: [], keys: [], example: null, profiles: [] },
    );
    expect(await screen.findByText('No .env files in this folder.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Configuration' })).toBeNull();
  });

  it('lists launch profiles and creates a missing environment file', async () => {
    const { of } = setup();
    const profiles = await screen.findByRole('list', { name: 'Launch profiles' });
    expect(profiles).toHaveTextContent('http → Development');
    expect(
      within(profiles).queryByRole('button', { name: 'Create appsettings.Development.json' }),
    ).toBeNull();
    await userEvent.click(
      within(profiles).getByRole('button', { name: 'Create appsettings.Production.json' }),
    );
    await waitFor(() => expect(of('createConfigFile')).toEqual([{ environment: 'Production' }]));
  });

  it('reveals one value', async () => {
    const { of } = setup();
    await table();
    await userEvent.click(
      screen.getByRole('button', { name: 'Reveal ConnectionStrings:Default in appsettings.json' }),
    );
    expect(await screen.findByText(SECRET)).toBeInTheDocument();
    expect(of('configReveal')).toEqual([
      { file: 'appsettings.json', key: 'ConnectionStrings:Default' },
    ]);
  });

  it('edits a value with its type and the version it was based on', async () => {
    const { of } = setup();
    await table();
    await userEvent.click(
      screen.getByRole('button', { name: 'Edit Retries in appsettings.Development.json' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'Type' })).toHaveValue('number');
    const input = await within(dialog).findByDisplayValue('3');
    await userEvent.clear(input);
    await userEvent.type(input, 'abc');
    expect(within(dialog).getByText('Not a number.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, '5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(of('configSetValue')).toEqual([
        {
          file: 'appsettings.Development.json',
          key: 'Retries',
          value: '5',
          type: 'number',
          version: 'v-appsettings.Development.json',
        },
      ]),
    );
  });

  it('adds a key with a type, refusing one the file already has', async () => {
    const { of } = setup();
    await table();
    await userEvent.click(screen.getByRole('button', { name: 'Add key' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add key' });
    await userEvent.type(
      within(dialog).getByRole('combobox', { name: 'Key' }),
      'connectionstrings:default',
    );
    expect(within(dialog).getByText(/already has connectionstrings:default/)).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByRole('combobox', { name: 'Key' }));
    await userEvent.type(within(dialog).getByRole('combobox', { name: 'Key' }), 'Features:Beta');
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Type' }),
      'boolean',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(of('configAddKey')).toEqual([
        {
          file: 'appsettings.json',
          key: 'Features:Beta',
          value: 'true',
          type: 'boolean',
          version: 'v-appsettings.json',
        },
      ]),
    );
  });

  it('removes a key after a confirm', async () => {
    const { of } = setup();
    await table();
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Remove ConnectionStrings:Default from appsettings.json',
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(of('configRemoveKey')).toEqual([
        {
          file: 'appsettings.json',
          key: 'ConnectionStrings:Default',
          version: 'v-appsettings.json',
        },
      ]),
    );
  });

  it('warns about an invalid file and offers it only as text', async () => {
    // An invalid file contributes no keys: its cells are all absent.
    const keys: ConfigMatrix['keys'] = CONFIG.keys
      .filter((k) => k.cells['appsettings.json'] !== 'absent')
      .map((k) => ({
        ...k,
        cells: { ...k.cells, 'appsettings.Development.json': 'absent' },
        overridden: false,
        envOnly: false,
      }));
    const { of } = setup({
      ...CONFIG,
      keys,
      files: [
        file('appsettings.json'),
        file('appsettings.Development.json', { invalid: true, entries: 0 }),
      ],
    });
    await table();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "appsettings.Development.json isn't valid JSON",
    );
    expect(screen.queryByRole('button', { name: /in appsettings\.Development\.json$/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Edit as text' }));
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'appsettings.Development.json' }),
    );
    expect(await screen.findByDisplayValue('{ "A": 1 }')).toBeInTheDocument();
    expect(of('readConfigRaw')).toEqual([{ file: 'appsettings.Development.json' }]);
  });

  it('says when a .NET package has no settings files yet', async () => {
    setup({ ...CONFIG, files: [], keys: [] });
    expect(await screen.findByText('No appsettings files in this folder.')).toBeInTheDocument();
  });
});
