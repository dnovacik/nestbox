import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { CiJobs, CiLog, CiRuns, CiStatus } from '@shared/tools/ci/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { ciJob, ciRun, ciStatus } from './fixtures';
import CiPanel from './Panel';

type Call = { method: string; input: unknown };

function setup(
  status: CiStatus,
  answers: { runs?: CiRuns; jobs?: CiJobs; log?: CiLog; rerun?: unknown } = {},
) {
  const calls: Call[] = [];
  const bridge = installMockBridge({
    'app:openExternal': () => undefined,
    'tools:invoke': (({ method, input }: Call) => {
      calls.push({ method, input });
      if (method === 'status') return status;
      if (method === 'runs') return answers.runs ?? { state: 'failed' };
      if (method === 'jobs') return answers.jobs ?? { state: 'ok', jobs: [] };
      if (method === 'jobLog') return answers.log ?? { state: 'failed' };
      if (method === 'rerunFailed') return answers.rerun ?? { ok: true, retried: 1 };
      return undefined;
    }) as never,
  });
  renderWithProviders(<CiPanel projectId="p1" />);
  return { bridge, of: (m: string) => calls.filter((c) => c.method === m).map((c) => c.input) };
}

const FAILED = ciRun({ id: '7', title: 'Fix totals', state: 'failure' });

describe('CiPanel', () => {
  it("lists the branch's runs and the newest run's jobs", async () => {
    const { of } = setup(ciStatus(), {
      runs: { state: 'ok', branch: 'main', filtered: true, runs: [FAILED, ciRun()] },
      jobs: {
        state: 'ok',
        jobs: [
          ciJob({ id: '1', name: 'build' }),
          ciJob({ id: '2', name: 'e2e', state: 'failure', failedStep: 'Run pnpm e2e' }),
        ],
      },
    });
    const runs = await screen.findByRole('list', { name: 'Runs' });
    expect(within(runs).getAllByRole('listitem')).toHaveLength(2);
    expect(of('runs')).toEqual([{ scope: 'branch' }]);
    const detail = await screen.findByRole('region', { name: 'Run details' });
    expect(await within(detail).findByText('e2e')).toBeInTheDocument();
    expect(within(detail).getByText('· Run pnpm e2e')).toBeInTheDocument();
    expect(of('jobs')).toEqual([{ runId: '7' }]);
  });

  it("shows a failed job's log tail on request", async () => {
    const { of } = setup(ciStatus(), {
      runs: { state: 'ok', branch: 'main', filtered: true, runs: [FAILED] },
      jobs: { state: 'ok', jobs: [ciJob({ id: '2', name: 'e2e', state: 'failure' })] },
      log: { state: 'ok', lines: ['1 failed', 'exit code 1'], truncated: true },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Show log of e2e' }));
    const log = await screen.findByLabelText('Log of e2e');
    expect(log).toHaveTextContent('exit code 1');
    expect(log).toHaveTextContent('earlier lines');
    expect(of('jobLog')).toEqual([{ runId: '7', jobId: '2' }]);
  });

  it('re-runs the failed jobs of a failed run', async () => {
    const { of } = setup(ciStatus(), {
      runs: { state: 'ok', branch: 'main', filtered: true, runs: [FAILED] },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Re-run failed jobs' }));
    await waitFor(() => expect(of('rerunFailed')).toEqual([{ runId: '7' }]));
  });

  it('switches to every branch', async () => {
    const { of } = setup(ciStatus(), {
      runs: { state: 'ok', branch: null, filtered: false, runs: [ciRun()] },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'All branches' }));
    await waitFor(() => expect(of('runs')).toEqual([{ scope: 'branch' }, { scope: 'all' }]));
  });

  it('offers the login when the CLI is logged out', async () => {
    const { of } = setup(ciStatus(), { runs: { state: 'logged-out' } });
    expect(await screen.findByText('The CLI is not logged in.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(of('login')).toEqual([{}]));
  });

  it('explains a missing CLI and a missing remote without listing anything', async () => {
    const { of, bridge } = setup(ciStatus({ cli: 'missing' }));
    await userEvent.click(await screen.findByRole('button', { name: 'How to install gh' }));
    expect(bridge.callsTo('app:openExternal')).toEqual([{ url: 'https://cli.github.com' }]);
    expect(of('runs')).toEqual([]);
  });

  it('explains what counts as a CI remote', async () => {
    setup(ciStatus({ provider: null, cli: 'missing', install: null, loginCommand: null }));
    expect(await screen.findByText('No GitHub or GitLab remote')).toBeInTheDocument();
  });
});
