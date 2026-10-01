import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NestboxError } from '@shared/errors';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { LogLineStore } from './line-store';
import { useLogStream } from './use-log-stream';

function Probe() {
  const { lines, status } = useLogStream('p1', 'dev');
  return (
    <div>
      <span data-testid="status">{status}</span>
      {lines.map((l) => (
        <p key={l.seq}>{l.text}</p>
      ))}
    </div>
  );
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe('useLogStream recovery', () => {
  it('retries a failed snapshot and shows the lines once it works', async () => {
    let fail = true;
    installMockBridge({
      'tools:invoke': (() => {
        if (fail) throw new NestboxError('NOT_FOUND', 'Project not found');
        return { lines: [{ seq: 1, ts: 1, stream: 'stdout', text: 'back' }], firstSeq: 1, lastSeq: 1 };
      }) as never,
    });
    renderWithProviders(<Probe />);
    expect(await screen.findByText('error')).toBeInTheDocument();
    fail = false;
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(await screen.findByText('back')).toBeInTheDocument();
    expect(screen.getByTestId('status')).toHaveTextContent('ready');
  });
});

describe('LogLineStore pending bound', () => {
  it('keeps at most cap queued lines while not ready', () => {
    const store = new LogLineStore(3);
    store.append([1, 2, 3, 4, 5].map((seq) => ({ seq, ts: seq, stream: 'stdout' as const, text: `l${seq}` })));
    expect(store.pendingSize).toBe(3);
    store.applySnapshot({ lines: [], firstSeq: 3, lastSeq: 2 }, 'replace');
    expect(store.getSnapshot().map((l) => l.seq)).toEqual([3, 4, 5]);
  });
});
