import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LogLine } from '@shared/processes';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { composeStatus } from './fixtures';
import { composeLogSource, useComposeStatus } from './use-compose';

function Probe({ projectId }: { projectId: string }) {
  const { data } = useComposeStatus(projectId);
  return <p>{data ? data.state : 'loading'}</p>;
}

describe('useComposeStatus', () => {
  it('refetches on the changed event of its project', async () => {
    const bridge = installMockBridge({ 'tools:invoke': (() => composeStatus([])) as never });
    const view = renderWithProviders(<Probe projectId="p1" />);
    await view.findByText('ok');
    const count = () => bridge.callsTo('tools:invoke').length;
    expect(count()).toBe(1);
    bridge.emit('tools:event', {
      toolId: 'compose',
      projectId: 'other',
      event: 'changed',
      payload: undefined,
    });
    bridge.emit('tools:event', {
      toolId: 'compose',
      projectId: 'p1',
      event: 'changed',
      payload: undefined,
    });
    await waitFor(() => expect(count()).toBe(2));
  });
});

describe('composeLogSource', () => {
  it('reads and receives only its own source, keyed by the followed service', async () => {
    const bridge = installMockBridge({
      'tools:invoke': (() => ({ lines: [], firstSeq: 1, lastSeq: 0 })) as never,
    });
    const actions = composeLogSource('p1', null);
    const db = composeLogSource('p1', 'db');
    expect(actions.key).not.toBe(db.key);
    expect(composeLogSource('p1', 'web').key).not.toBe(db.key);
    await db.snapshot(4);
    expect(bridge.callsTo('tools:invoke').at(-1)).toMatchObject({
      toolId: 'compose',
      method: 'getLogs',
      input: { source: 'service', afterSeq: 4 },
    });
    const got = vi.fn();
    const off = db.subscribe(got);
    const line: LogLine = { seq: 1, ts: 1, stream: 'stdout', text: 'ready' };
    bridge.emit('tools:event', {
      toolId: 'compose',
      projectId: 'p1',
      event: 'logs',
      payload: { source: 'actions', lines: [line] },
    });
    bridge.emit('tools:event', {
      toolId: 'compose',
      projectId: 'p1',
      event: 'logs',
      payload: { source: 'service', lines: [line] },
    });
    expect(got).toHaveBeenCalledTimes(1);
    off();
  });
});
