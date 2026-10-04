import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { mockConfig, mockStatus } from './fixtures';
import { useMock } from './use-mock';

function Probe({ projectId }: { projectId: string }) {
  const { status } = useMock(projectId);
  return <p>{status ? (status.running ? 'running' : 'stopped') : 'loading'}</p>;
}

describe('useMock', () => {
  it('refetches the status and config on the changed event of its project', async () => {
    const bridge = installMockBridge({
      'tools:invoke': (({ method }: { method: string }) =>
        method === 'config' ? mockConfig() : mockStatus()) as never,
    });
    const view = renderWithProviders(<Probe projectId="p1" />);
    await view.findByText('stopped');
    const count = () => bridge.callsTo('tools:invoke').length;
    expect(count()).toBe(2);
    bridge.emit('tools:event', {
      toolId: 'mock',
      projectId: 'other',
      event: 'changed',
      payload: undefined,
    });
    bridge.emit('tools:event', {
      toolId: 'mock',
      projectId: 'p1',
      event: 'changed',
      payload: undefined,
    });
    await waitFor(() => expect(count()).toBe(4));
  });
});
