import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { DomainsStatus } from '@shared/domains';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { DomainLink, domainUrl } from './DomainLink';

const running = { state: 'running' as const, code: null, owner: null };
const status = (over: Partial<DomainsStatus> = {}): DomainsStatus => ({
  enabled: true,
  http: { ...running, port: 80 },
  https: { ...running, port: 443 },
  trust: 'trusted',
  routes: [
    {
      name: 'shop.localhost',
      projectId: 'p1',
      script: 'dev',
      port: 5173,
      source: 'main',
      rewriteHost: false,
    },
  ],
  clashes: [],
  ...over,
});

describe('domainUrl', () => {
  it('prefers HTTPS and drops default ports', () => {
    expect(domainUrl(status(), 'shop.localhost')).toBe('https://shop.localhost');
    expect(domainUrl(status({ https: { ...running, port: 8443 } }), 'shop.localhost')).toBe(
      'https://shop.localhost:8443',
    );
    expect(
      domainUrl(
        status({ https: { state: 'failed', port: 443, code: 'EADDRINUSE', owner: null } }),
        'shop.localhost',
      ),
    ).toBe('http://shop.localhost');
  });
});

describe('DomainLink', () => {
  it('opens the URL through main', async () => {
    const opened: unknown[] = [];
    installMockBridge({
      'domains:status': () => status(),
      'app:openExternal': (i: unknown) => void opened.push(i),
    } as never);
    renderWithProviders(<DomainLink projectId="p1" />);
    await userEvent.click(await screen.findByRole('link', { name: 'https://shop.localhost' }));
    expect(opened).toEqual([{ url: 'https://shop.localhost' }]);
  });

  it('is greyed out with a reason when nothing runs, and hidden while domains are off', async () => {
    installMockBridge({
      'domains:status': () =>
        status({
          routes: [
            {
              name: 'shop.localhost',
              projectId: 'p1',
              script: null,
              port: null,
              source: 'none',
              rewriteHost: false,
            },
          ],
        }),
    } as never);
    const { unmount } = renderWithProviders(<DomainLink projectId="p1" />);
    expect(await screen.findByText('https://shop.localhost')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    unmount();
    installMockBridge({ 'domains:status': () => status({ enabled: false }) } as never);
    renderWithProviders(<DomainLink projectId="p1" />);
    await expect(screen.findByText(/shop\.localhost/, {}, { timeout: 300 })).rejects.toThrow();
  });

  it('copies the address through main (the renderer has no clipboard permission)', async () => {
    const copied: unknown[] = [];
    installMockBridge({
      'domains:status': () => status(),
      'domains:copyUrl': (input: unknown) => {
        copied.push(input);
        return { url: 'https://shop.localhost' };
      },
    } as never);
    renderWithProviders(<DomainLink projectId="p1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Copy local domain' }));
    expect(await screen.findByText('Copied https://shop.localhost')).toBeInTheDocument();
    expect(copied).toEqual([{ projectId: 'p1' }]);
  });

  it('shows a toast when main refuses to copy', async () => {
    installMockBridge({
      'domains:status': () => status(),
      'domains:copyUrl': () => {
        throw Object.assign(new Error('Unknown project'), { code: 'NOT_FOUND' });
      },
    } as never);
    renderWithProviders(<DomainLink projectId="p1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Copy local domain' }));
    expect(await screen.findByText("Couldn't copy the address")).toBeInTheDocument();
  });
});
