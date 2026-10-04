import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { EnvCompare } from '@shared/tools/deploy/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { EnvCompareRow } from './EnvCompare';
import { platformStatus } from './fixtures';

type Call = { method: string; input: unknown };

function setup(answer: EnvCompare, envFiles = ['.env', '.env.production']) {
  const calls: Call[] = [];
  installMockBridge({
    'tools:invoke': (({ method, input }: Call) => {
      calls.push({ method, input });
      return answer;
    }) as never,
  });
  renderWithProviders(
    <EnvCompareRow
      projectId="p1"
      p={platformStatus()}
      envFiles={envFiles}
      defaultEnvFile=".env.production"
    />,
  );
  return { calls };
}

describe('EnvCompareRow', () => {
  it('compares only on click, with production and the default file preselected', async () => {
    const { calls } = setup({
      state: 'ok',
      onlyLocal: ['LOCAL_ONLY'],
      onlyRemote: ['STRIPE_SECRET'],
      both: ['DATABASE_URL'],
    });
    const row = screen.getByRole('group', { name: 'Vercel env' });
    expect(within(row).getByRole('combobox', { name: 'Local env file' })).toHaveTextContent(
      '.env.production',
    );
    expect(within(row).getByRole('combobox', { name: 'Vercel environment' })).toHaveTextContent(
      'production',
    );
    expect(calls).toEqual([]);
    await userEvent.click(within(row).getByRole('button', { name: 'Compare' }));
    expect(await within(row).findByRole('list', { name: 'Missing on Vercel' })).toHaveTextContent(
      'LOCAL_ONLY',
    );
    expect(within(row).getByRole('list', { name: 'Only on Vercel' })).toHaveTextContent(
      'STRIPE_SECRET',
    );
    expect(within(row).getByText('1 keys in both.')).toBeInTheDocument();
    expect(calls).toEqual([
      {
        method: 'envCompare',
        input: { platform: 'vercel', environment: 'production', file: '.env.production' },
      },
    ]);
  });

  it('compares against another environment picked in the selector', async () => {
    const { calls } = setup({ state: 'ok', onlyLocal: [], onlyRemote: [], both: ['A', 'B'] });
    const row = screen.getByRole('group', { name: 'Vercel env' });
    await userEvent.click(within(row).getByRole('combobox', { name: 'Vercel environment' }));
    await userEvent.click(await screen.findByRole('option', { name: 'preview' }));
    await userEvent.click(within(row).getByRole('button', { name: 'Compare' }));
    expect(
      await within(row).findByText('Same 2 keys in .env.production and on Vercel (preview).'),
    ).toBeInTheDocument();
    await waitFor(() => expect(calls[0]?.input).toMatchObject({ environment: 'preview' }));
  });

  it('says why a comparison could not run, and when there is no env file', async () => {
    setup({ state: 'logged-out' });
    await userEvent.click(screen.getByRole('button', { name: 'Compare' }));
    expect(await screen.findByText('The CLI is not logged in.')).toBeInTheDocument();
  });

  it('has nothing to compare without env files', () => {
    setup({ state: 'failed' }, []);
    expect(screen.getByText('No env file to compare with Vercel.')).toBeInTheDocument();
  });
});
