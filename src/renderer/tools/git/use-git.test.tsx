import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { useGitStatus } from './use-git';

function Probe({ projectId }: { projectId: string }) {
  const { data } = useGitStatus(projectId);
  return <p>{data ? data.state : 'loading'}</p>;
}

describe('useGitStatus', () => {
  it('refetches on the changed event of its project and on window focus', async () => {
    const bridge = installMockBridge({ 'tools:invoke': (() => ({ state: 'failed' })) as never });
    const view = renderWithProviders(<Probe projectId="p1" />);
    await view.findByText('failed');
    const statusCalls = () => bridge.callsTo('tools:invoke').length;
    expect(statusCalls()).toBe(1);

    bridge.emit('tools:event', { toolId: 'git', projectId: 'other', event: 'changed', payload: undefined });
    bridge.emit('tools:event', { toolId: 'git', projectId: 'p1', event: 'changed', payload: undefined });
    await waitFor(() => expect(statusCalls()).toBe(2));

    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(statusCalls()).toBe(3));
  });
});
