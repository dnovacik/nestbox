import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { DomainsStatus } from '@shared/domains';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { DomainsSettings } from './DomainsSettings';

const status = (over: Partial<DomainsStatus> = {}): DomainsStatus => ({
  enabled: false,
  http: { state: 'off', port: 80, code: null, owner: null },
  https: { state: 'off', port: 443, code: null, owner: null },
  trust: 'none',
  routes: [],
  clashes: [],
  ...over,
});

describe('DomainsSettings', () => {
  it('turns domains on and asks main to trust the CA the first time', async () => {
    const calls: string[] = [];
    let current = status();
    installMockBridge({
      'domains:status': () => current,
      'domains:setEnabled': ({ enabled }: { enabled: boolean }) => {
        calls.push(`enabled:${enabled}`);
        current = status({
          enabled,
          http: { state: 'running', port: 80, code: null, owner: null },
          https: { state: 'running', port: 443, code: null, owner: null },
        });
        return current;
      },
      'domains:trustCa': () => {
        calls.push('trust');
        current = { ...current, trust: 'trusted' };
        return { result: 'trusted' };
      },
    } as never);
    renderWithProviders(<DomainsSettings />);
    await userEvent.click(await screen.findByRole('switch', { name: 'Local domains' }));
    await waitFor(() => expect(calls).toEqual(['enabled:true', 'trust']));
    expect(await screen.findByText('Trusted')).toBeInTheDocument();
  });

  it('offers removing the CA while domains are off, only when there is one', async () => {
    let removed = 0;
    installMockBridge({
      'domains:status': () => status({ enabled: false, trust: 'trusted' }),
      'domains:removeCa': () => {
        removed += 1;
        return { result: 'removed' };
      },
    } as never);
    renderWithProviders(<DomainsSettings />);
    await userEvent.click(
      await screen.findByRole('button', { name: "Remove NestBox's certificate authority" }),
    );
    await waitFor(() => expect(removed).toBe(1));
  });

  it('hides Remove when domains are off and nothing is trusted', async () => {
    installMockBridge({
      'domains:status': () => status({ enabled: false, trust: 'none' }),
    } as never);
    renderWithProviders(<DomainsSettings />);
    await screen.findByRole('switch', { name: 'Local domains' });
    expect(
      screen.queryByRole('button', { name: "Remove NestBox's certificate authority" }),
    ).not.toBeInTheDocument();
  });

  it("shows why a server couldn't start", async () => {
    installMockBridge({
      'domains:status': () =>
        status({
          enabled: true,
          https: { state: 'failed', port: 443, code: 'EADDRINUSE', owner: 'httpd.exe' },
          trust: 'trusted',
        }),
    } as never);
    renderWithProviders(<DomainsSettings />);
    expect(await screen.findByText('Port 443 is in use by httpd.exe')).toBeInTheDocument();
  });

  it('saves new ports and refuses equal ones', async () => {
    const seen: unknown[] = [];
    installMockBridge({
      'domains:status': () => status({ enabled: true }),
      'domains:setPorts': (input: unknown) => {
        seen.push(input);
        return status({ enabled: true });
      },
    } as never);
    renderWithProviders(<DomainsSettings />);
    const http = await screen.findByLabelText('HTTP port');
    await userEvent.clear(http);
    await userEvent.type(http, '443');
    expect(screen.getByRole('button', { name: 'Apply ports' })).toBeDisabled();
    await userEvent.clear(http);
    await userEvent.type(http, '8080');
    await userEvent.click(screen.getByRole('button', { name: 'Apply ports' }));
    await waitFor(() => expect(seen).toEqual([{ httpPort: 8080, httpsPort: 443 }]));
  });
});
