import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DeployStatus, Listing } from '@shared/tools/deploy/contract';
import { makeSummary } from '@/test/fixtures';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { deployment, deployStatus, platformStatus } from './fixtures';
import DeployPanel from './Panel';

type Call = { method: string; input: unknown };

beforeAll(() => {
  // react-virtual sizes its viewport from offsetHeight/offsetWidth, which jsdom reports as 0.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 400,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 800,
  });
});

function setup(status: DeployStatus, listings: Partial<Record<string, Listing>> = {}) {
  const calls: Call[] = [];
  const bridge = installMockBridge({
    'projects:list': () => [makeSummary({ id: 'p1', name: 'Shop' })],
    'app:openExternal': () => undefined,
    'tools:invoke': (({ method, input }: Call) => {
      calls.push({ method, input });
      if (method === 'status') return status;
      if (method === 'getLogs') return { lines: [], firstSeq: 1, lastSeq: 0 };
      if (method === 'deployments')
        return listings[(input as { platform: string }).platform] ?? { state: 'failed' };
      if (method === 'deploy') return { ok: true, code: 0, url: 'https://x.vercel.app' };
      return undefined;
    }) as never,
  });
  renderWithProviders(<DeployPanel projectId="p1" />);
  return { bridge, of: (m: string) => calls.filter((c) => c.method === m).map((c) => c.input) };
}

describe('DeployPanel', () => {
  it('lists deployments when it opens, with state, environment, branch and links', async () => {
    const { of, bridge } = setup(deployStatus([platformStatus()]), {
      vercel: {
        state: 'ok',
        deployments: [
          deployment(),
          deployment({
            id: 'dpl_2',
            state: 'error',
            environment: 'preview',
            branch: 'feature/x',
            url: null,
          }),
        ],
      },
    });
    const table = await screen.findByRole('table', { name: 'Vercel deployments' });
    const [, first, second] = within(table).getAllByRole('row');
    expect(first).toHaveTextContent('Ready');
    expect(first).toHaveTextContent('production');
    expect(second).toHaveTextContent('Failed');
    expect(second).toHaveTextContent('feature/x');
    await userEvent.click(within(table).getByRole('button', { name: 'Open deployment dpl_1' }));
    expect(bridge.callsTo('app:openExternal')).toEqual([{ url: 'https://shop.vercel.app' }]);
    expect(of('deployments')).toEqual([{ platform: 'vercel' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh Vercel deployments' }));
    await waitFor(() => expect(of('deployments')).toHaveLength(2));
  });

  it('deploys a preview at once', async () => {
    const { of } = setup(deployStatus([platformStatus()]), {
      vercel: { state: 'ok', deployments: [] },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Deploy preview' }));
    await waitFor(() => expect(of('deploy')).toEqual([{ platform: 'vercel', target: 'preview' }]));
  });

  it('asks before production, naming the package and the platform', async () => {
    const { of } = setup(
      deployStatus([platformStatus({ platform: 'fly', name: 'shop-api', preview: false })]),
      {
        fly: { state: 'ok', deployments: [] },
      },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Deploy to production…' }));
    const dialog = await screen.findByRole('alertdialog');
    await waitFor(() => expect(dialog).toHaveTextContent('Deploy Shop to production on Fly.io?'));
    expect(dialog).toHaveTextContent('shop-api goes live');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(of('deploy')).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Deploy to production…' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Deploy to production' }));
    await waitFor(() =>
      expect(of('deploy')).toEqual([{ platform: 'fly', target: 'production', confirmed: true }]),
    );
    expect(screen.queryByRole('button', { name: 'Deploy preview' })).toBeNull();
  });

  it('offers Log in when the CLI is logged out, and shows Netlify’s site', async () => {
    const { of } = setup(
      deployStatus([platformStatus(), platformStatus({ platform: 'netlify', name: null })]),
      {
        vercel: { state: 'logged-out' },
        netlify: {
          state: 'site',
          name: 'shop-acme',
          url: 'https://shop-acme.netlify.app',
          adminUrl: 'https://app.netlify.com/projects/shop-acme',
        },
      },
    );
    const vercel = await screen.findByRole('region', { name: 'Vercel' });
    await userEvent.click(await within(vercel).findByRole('button', { name: 'Log in' }));
    expect(of('login')).toEqual([{ platform: 'vercel' }]);
    const netlify = screen.getByRole('region', { name: 'Netlify' });
    expect(await within(netlify).findByText('shop-acme')).toBeInTheDocument();
    expect(within(netlify).getByRole('button', { name: 'Deploy history' })).toBeInTheDocument();
  });

  it('shows the install command, and the link button, without listing', async () => {
    const { of } = setup(
      deployStatus([
        platformStatus({ cli: 'missing', preview: false, production: false }),
        platformStatus({
          platform: 'netlify',
          linked: false,
          canLink: true,
          preview: false,
          production: false,
          hint: 'Not linked to a Netlify site yet.',
        }),
      ]),
    );
    expect(await screen.findByText('npm i -g vercel')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Link in a terminal' }));
    expect(of('link')).toEqual([{ platform: 'netlify' }]);
    expect(of('deployments')).toEqual([]);
  });

  it('cancels a running deploy', async () => {
    const { of } = setup(
      deployStatus([platformStatus()], { action: { platform: 'vercel', target: 'preview' } }),
      { vercel: { state: 'ok', deployments: [] } },
    );
    expect(await screen.findByRole('button', { name: 'Deploy preview' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel deploy' }));
    await waitFor(() => expect(of('cancel')).toEqual([{}]));
  });
});

describe('DeployPanel without a platform', () => {
  it('points to the packages that deploy, and offers to link this one', async () => {
    const { of } = setup(
      deployStatus([], {
        elsewhere: [{ projectId: 'p1::app', name: 'app', platforms: ['vercel'] }],
      }),
    );
    const help = await screen.findByRole('region', { name: 'Set up deploys' });
    expect(within(help).getByRole('button', { name: 'app · Vercel' })).toBeInTheDocument();
    await userEvent.click(
      within(help).getByRole('button', { name: 'Link to Netlify in a terminal' }),
    );
    await waitFor(() => expect(of('link')).toEqual([{ platform: 'netlify' }]));
  });
});
