import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { installMockBridge } from '@/test/mock-bridge';
import { useToolEvent } from './tool-events';

function Listener({ projectId, onLogs }: { projectId: string; onLogs: (payload: unknown) => void }) {
  useToolEvent('scripts', projectId, 'logs', onLogs);
  return null;
}

const payload = { script: 'dev', lines: [{ seq: 1, ts: 1, stream: 'stdout', text: 'hi' }] };

describe('useToolEvent', () => {
  it('delivers valid payloads for the matching tool, project and event', () => {
    const bridge = installMockBridge({});
    const onLogs = vi.fn();
    render(<Listener projectId="p1" onLogs={onLogs} />);
    bridge.emit('tools:event', { toolId: 'scripts', projectId: 'p1', event: 'logs', payload });
    expect(onLogs).toHaveBeenCalledWith(payload);
  });

  it('ignores other projects, events and tools, and drops invalid payloads', () => {
    const bridge = installMockBridge({});
    const onLogs = vi.fn();
    render(<Listener projectId="p1" onLogs={onLogs} />);
    bridge.emit('tools:event', { toolId: 'scripts', projectId: 'p2', event: 'logs', payload });
    bridge.emit('tools:event', { toolId: 'scripts', projectId: 'p1', event: 'other', payload });
    bridge.emit('tools:event', { toolId: 'project-info', projectId: 'p1', event: 'logs', payload });
    bridge.emit('tools:event', { toolId: 'scripts', projectId: 'p1', event: 'logs', payload: { script: 1 } });
    bridge.emit('tools:event', 'garbage');
    expect(onLogs).not.toHaveBeenCalled();
  });

  it('unsubscribes on unmount', () => {
    const bridge = installMockBridge({});
    const onLogs = vi.fn();
    const { unmount } = render(<Listener projectId="p1" onLogs={onLogs} />);
    unmount();
    bridge.emit('tools:event', { toolId: 'scripts', projectId: 'p1', event: 'logs', payload });
    expect(onLogs).not.toHaveBeenCalled();
  });
});
