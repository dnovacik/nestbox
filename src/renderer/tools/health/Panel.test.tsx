import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { HealthStatus } from '@shared/tools/health/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { checkResult, checkView, healthStatus } from './fixtures';
import HealthPanel from './Panel';

type Call = { method: string; input: unknown };

function setup(status: HealthStatus) {
  const calls: Call[] = [];
  installMockBridge({
    'tools:invoke': (({ method, input }: Call) => {
      calls.push({ method, input });
      return method === 'status' ? status : undefined;
    }) as never,
  });
  renderWithProviders(<HealthPanel projectId="p1" />);
  return { of: (m: string) => calls.filter((c) => c.method === m).map((c) => c.input) };
}

const STATUS = healthStatus({
  live: true,
  checks: [
    checkView('a', 'http://localhost:3000/', checkResult('ok')),
    checkView('b', 'API_URL · /', checkResult('config'), { kind: 'env', expect: 401 }),
  ],
  suggestions: { port: 5173, envKeys: ['AUTH_URL'] },
});

describe('HealthPanel', () => {
  it('lists the checks with their last result, and removes one', async () => {
    const { of } = setup(STATUS);
    const list = await screen.findByRole('list', { name: 'Checks' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('http://localhost:3000/');
    expect(rows[0]).toHaveTextContent('200 · 12 ms');
    expect(rows[1]).toHaveTextContent('not set in .env');
    expect(rows[1]).toHaveTextContent('expects 401');
    await userEvent.click(
      within(rows[1] as HTMLElement).getByRole('button', { name: 'Remove API_URL · /' }),
    );
    expect(of('removeCheck')).toEqual([{ id: 'b' }]);
  });

  it('adds a URL check with an expected status', async () => {
    const { of } = setup(STATUS);
    const form = await screen.findByRole('form', { name: 'Add check' });
    await userEvent.type(
      within(form).getByRole('textbox', { name: 'URL' }),
      'http://localhost:8080/health',
    );
    await userEvent.type(within(form).getByRole('textbox', { name: 'Expected status' }), '204');
    await userEvent.click(within(form).getByRole('button', { name: 'Add' }));
    expect(of('addCheck')).toEqual([
      { check: { kind: 'url', url: 'http://localhost:8080/health', expect: 204 } },
    ]);
  });

  it('refuses a URL that is not http(s) before sending it', async () => {
    const { of } = setup(STATUS);
    const form = await screen.findByRole('form', { name: 'Add check' });
    await userEvent.type(within(form).getByRole('textbox', { name: 'URL' }), 'ftp://x');
    await userEvent.click(within(form).getByRole('button', { name: 'Add' }));
    expect(within(form).getByText('An http(s) URL without a user or password')).toBeInTheDocument();
    expect(of('addCheck')).toEqual([]);
  });

  it('adds suggestions in one click', async () => {
    const { of } = setup(STATUS);
    const suggestions = await screen.findByRole('group', { name: 'Suggestions' });
    await userEvent.click(
      within(suggestions).getByRole('button', { name: 'http://localhost:5173/' }),
    );
    await userEvent.click(within(suggestions).getByRole('button', { name: 'AUTH_URL' }));
    expect(of('addCheck')).toEqual([
      { check: { kind: 'url', url: 'http://localhost:5173/' } },
      { check: { kind: 'env', key: 'AUTH_URL', path: '/' } },
    ]);
  });

  it('checks now and changes the notify option', async () => {
    const { of } = setup(STATUS);
    await userEvent.click(await screen.findByRole('button', { name: 'Check now' }));
    expect(of('checkNow')).toEqual([{}]);
    await userEvent.click(
      screen.getByRole('switch', { name: 'Notify when a check starts failing' }),
    );
    expect(of('setOptions')).toEqual([{ notify: false }]);
  });
});
