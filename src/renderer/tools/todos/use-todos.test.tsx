import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { todo, todoScan } from './fixtures';
import { useTodos } from './use-todos';

function Probe({ projectId }: { projectId: string }) {
  const { result, scanning } = useTodos(projectId);
  return <p>{scanning ? 'scanning' : result ? `${result.todos.length} found` : 'none'}</p>;
}

describe('useTodos', () => {
  it('scans once when there is no result yet', async () => {
    const bridge = installMockBridge({
      'tools:invoke': (({ method }: { method: string }) => (method === 'results' ? null : todoScan([todo('a.ts', 1, 'TODO', 'x')]))) as never,
    });
    const view = renderWithProviders(<Probe projectId="p1" />);
    await view.findByText('1 found');
    const methods = bridge.callsTo('tools:invoke').map((c) => (c as { method: string }).method);
    expect(methods.filter((m) => m === 'scan')).toHaveLength(1);
  });

  it('uses the cached result without scanning', async () => {
    const bridge = installMockBridge({ 'tools:invoke': (() => todoScan([])) as never });
    const view = renderWithProviders(<Probe projectId="p1" />);
    await view.findByText('0 found');
    await waitFor(() => expect(bridge.callsTo('tools:invoke').map((c) => (c as { method: string }).method)).toEqual(['results']));
  });
});
