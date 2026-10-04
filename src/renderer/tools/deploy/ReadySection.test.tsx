import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Readiness } from '@shared/tools/deploy/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { ReadySection } from './ReadySection';

type Call = { method: string; input: unknown };

const DONE: Readiness = {
  at: Date.now(),
  overall: 'red',
  checks: [
    { kind: 'node', label: 'Node', tone: 'ok', detail: 'Local v22.11.0 matches .nvmrc' },
    {
      kind: 'env',
      label: 'Env',
      tone: 'fail',
      detail: '1 key missing on Vercel (production): LOCAL_ONLY',
    },
    { kind: 'git', label: 'Git', tone: 'warn', detail: '2 uncommitted changes' },
    { kind: 'script', label: 'build', tone: 'ok', detail: 'Exited with code 0' },
  ],
};

function setup(ready: Readiness | null, scripts = ['build', 'dev', 'lint', 'test']) {
  const calls: Call[] = [];
  installMockBridge({
    'tools:invoke': (({ method, input }: Call) => {
      calls.push({ method, input });
      return DONE;
    }) as never,
  });
  renderWithProviders(<ReadySection projectId="p1" scripts={scripts} ready={ready} />);
  return { calls, section: screen.getByRole('region', { name: 'Ready to deploy' }) };
}

describe('ReadySection', () => {
  it('preselects build, test, lint and typecheck when present, and runs the picked ones', async () => {
    const { calls, section } = setup(null);
    const group = within(section).getByRole('group', { name: 'Scripts to run' });
    expect(within(group).getByRole('button', { name: 'build' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(group).getByRole('button', { name: 'dev' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await userEvent.click(within(group).getByRole('button', { name: 'lint' }));
    await userEvent.click(within(section).getByRole('button', { name: 'Run checks' }));
    await waitFor(() =>
      expect(calls).toEqual([{ method: 'checkReady', input: { scripts: ['build', 'test'] } }]),
    );
  });

  it('shows each check with its tone and the summary', () => {
    const { section } = setup(DONE);
    expect(within(section).getByText('Not ready')).toBeInTheDocument();
    const items = within(within(section).getByRole('list', { name: 'Checks' })).getAllByRole(
      'listitem',
    );
    expect(items.map((li) => li.textContent)).toEqual([
      'NodepassedLocal v22.11.0 matches .nvmrc',
      'Envfailed1 key missing on Vercel (production): LOCAL_ONLY',
      'Gitwarning2 uncommitted changes',
      'buildpassedExited with code 0',
    ]);
  });

  it('disables Run checks while a run is in progress', () => {
    const { section } = setup({ ...DONE, overall: null });
    expect(within(section).getByRole('button', { name: 'Checking…' })).toBeDisabled();
    expect(within(section).queryByText('Not ready')).toBeNull();
  });
});
