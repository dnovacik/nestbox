import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { inspectorConfig, inspectorStatus } from './fixtures';
import { useInspector } from './use-inspector';

function Probe({ projectId }: { projectId: string }) {
  const { status } = useInspector(projectId);
  return <p>{status ? 'ready' : 'loading'}</p>;
}

describe('useInspector', () => {
  it('refetches the list on the entries event of its project', async () => {
    const bridge = installMockBridge({
      'tools:invoke': (({ method }: { method: string }) =>
        method === 'config'
          ? inspectorConfig()
          : method === 'list'
            ? []
            : inspectorStatus()) as never,
    });
    const view = renderWithProviders(<Probe projectId="p1" />);
    await view.findByText('ready');
    const lists = () =>
      bridge.callsTo('tools:invoke').filter((c) => (c as { method: string }).method === 'list')
        .length;
    expect(lists()).toBe(1);
    bridge.emit('tools:event', {
      toolId: 'inspector',
      projectId: 'other',
      event: 'entries',
      payload: undefined,
    });
    bridge.emit('tools:event', {
      toolId: 'inspector',
      projectId: 'p1',
      event: 'entries',
      payload: undefined,
    });
    await waitFor(() => expect(lists()).toBe(2));
  });
});
