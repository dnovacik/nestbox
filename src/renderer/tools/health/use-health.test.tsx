import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { healthStatus } from './fixtures';
import { useHealth } from './use-health';

function Probe({ projectId }: { projectId: string }) {
  const { data } = useHealth(projectId);
  return <p>{data ? (data.live ? 'live' : 'idle') : 'loading'}</p>;
}

describe('useHealth', () => {
  it("refetches on its project's health and env changes", async () => {
    const bridge = installMockBridge({ 'tools:invoke': (() => healthStatus()) as never });
    const view = renderWithProviders(<Probe projectId="p1" />);
    await view.findByText('idle');
    const statusCalls = () => bridge.callsTo('tools:invoke').length;
    expect(statusCalls()).toBe(1);

    bridge.emit('tools:event', {
      toolId: 'health',
      projectId: 'other',
      event: 'changed',
      payload: undefined,
    });
    bridge.emit('tools:event', {
      toolId: 'health',
      projectId: 'p1',
      event: 'changed',
      payload: undefined,
    });
    await waitFor(() => expect(statusCalls()).toBe(2));

    bridge.emit('tools:event', {
      toolId: 'env',
      projectId: 'p1',
      event: 'changed',
      payload: undefined,
    });
    await waitFor(() => expect(statusCalls()).toBe(3));
  });
});
