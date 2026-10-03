import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { dbStatus } from './fixtures';
import { useDatabaseStatus } from './use-database';

function Probe({ projectId }: { projectId: string }) {
  const { data } = useDatabaseStatus(projectId);
  return <p>{data ? data.variable : 'loading'}</p>;
}

describe('useDatabaseStatus', () => {
  it('refetches on its own changed event, on the env tool changing .env, and on window focus', async () => {
    const bridge = installMockBridge({ 'tools:invoke': (() => dbStatus()) as never });
    const view = renderWithProviders(<Probe projectId="p1" />);
    await view.findByText('DATABASE_URL');
    const calls = () => bridge.callsTo('tools:invoke').length;
    expect(calls()).toBe(1);

    bridge.emit('tools:event', { toolId: 'database', projectId: 'p1', event: 'changed', payload: undefined });
    await waitFor(() => expect(calls()).toBe(2));
    bridge.emit('tools:event', { toolId: 'env', projectId: 'other', event: 'changed', payload: undefined });
    bridge.emit('tools:event', { toolId: 'env', projectId: 'p1', event: 'changed', payload: undefined });
    await waitFor(() => expect(calls()).toBe(3));
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(calls()).toBe(4));
  });
});
