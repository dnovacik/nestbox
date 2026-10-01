import { act, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { LogLine, LogSnapshot } from '@shared/processes';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { useLogStream } from './use-log-stream';

const l = (seq: number, text = `line ${seq}`): LogLine => ({ seq, ts: seq, stream: 'stdout', text });

function Probe({ projectId = 'p1', script = 'dev', id = 'a' }: { projectId?: string; script?: string | null; id?: string }) {
  const { lines, status, clear } = useLogStream(projectId, script);
  return (
    <div>
      <span data-testid={`status-${id}`}>{status}</span>
      <ul data-testid={`lines-${id}`}>
        {lines.map((line) => (
          <li key={line.seq}>{line.text}</li>
        ))}
      </ul>
      <button type="button" onClick={() => void clear()}>
        clear-{id}
      </button>
    </div>
  );
}

function Toggle() {
  const [on, setOn] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOn((v) => !v)}>
        toggle
      </button>
      <Probe script={on ? 'dev' : null} />
    </>
  );
}

function bridgeWith(getLogs: (input: { script: string; afterSeq?: number }) => LogSnapshot) {
  return installMockBridge({
    'tools:invoke': (({ method, input }: { method: string; input: unknown }) => {
      if (method === 'getLogs') return getLogs(input as { script: string; afterSeq?: number });
      if (method === 'clearLogs') return undefined;
      throw new Error(`unexpected ${method}`);
    }) as never,
  });
}

const batch = (lines: LogLine[], projectId = 'p1', script = 'dev') => ({
  toolId: 'scripts',
  projectId,
  event: 'logs',
  payload: { script, lines },
});

describe('useLogStream', () => {
  it('loads a snapshot and appends batches', async () => {
    const bridge = bridgeWith(() => ({ lines: [l(1)], firstSeq: 1, lastSeq: 1 }));
    renderWithProviders(<Probe />);
    expect(await screen.findByText('line 1')).toBeInTheDocument();
    act(() => bridge.emit('tools:event', batch([l(2)])));
    expect(await screen.findByText('line 2')).toBeInTheDocument();
    expect(screen.getByTestId('status-a')).toHaveTextContent('ready');
  });

  it('fetches a delta after a gap', async () => {
    const bridge = bridgeWith(({ afterSeq }) =>
      afterSeq === undefined ? { lines: [l(1)], firstSeq: 1, lastSeq: 1 } : { lines: [l(2), l(3)], firstSeq: 2, lastSeq: 3 },
    );
    renderWithProviders(<Probe />);
    await screen.findByText('line 1');
    act(() => bridge.emit('tools:event', batch([l(3)])));
    expect(await screen.findByText('line 2')).toBeInTheDocument();
    expect(screen.getByTestId('lines-a').children).toHaveLength(3);
    expect(bridge.callsTo('tools:invoke')).toContainEqual(
      expect.objectContaining({ method: 'getLogs', input: { script: 'dev', afterSeq: 1 } }),
    );
  });

  it('shares one snapshot between two panes of the same script', async () => {
    const bridge = bridgeWith(() => ({ lines: [l(1)], firstSeq: 1, lastSeq: 1 }));
    renderWithProviders(
      <>
        <Probe id="a" />
        <Probe id="b" />
      </>,
    );
    await waitFor(() => expect(screen.getAllByText('line 1')).toHaveLength(2));
    expect(bridge.callsTo('tools:invoke')).toHaveLength(1);
    act(() => bridge.emit('tools:event', batch([l(2)])));
    await waitFor(() => expect(screen.getAllByText('line 2')).toHaveLength(2));
  });

  it('ignores other projects and scripts', async () => {
    const bridge = bridgeWith(() => ({ lines: [], firstSeq: 1, lastSeq: 0 }));
    renderWithProviders(<Probe />);
    await waitFor(() => expect(screen.getByTestId('status-a')).toHaveTextContent('ready'));
    act(() => {
      bridge.emit('tools:event', batch([l(1, 'other project')], 'p2'));
      bridge.emit('tools:event', batch([l(1, 'other script')], 'p1', 'build'));
    });
    expect(screen.queryByText(/other/)).toBeNull();
  });

  it('refetches after every consumer unmounted', async () => {
    const bridge = bridgeWith(() => ({ lines: [l(1)], firstSeq: 1, lastSeq: 1 }));
    renderWithProviders(<Toggle />);
    await screen.findByText('line 1');
    act(() => screen.getByRole('button', { name: 'toggle' }).click());
    expect(screen.queryByText('line 1')).toBeNull();
    act(() => screen.getByRole('button', { name: 'toggle' }).click());
    await screen.findByText('line 1');
    expect(bridge.callsTo('tools:invoke')).toHaveLength(2);
  });

  it('clears through the tool and empties the list', async () => {
    const bridge = bridgeWith(() => ({ lines: [l(1)], firstSeq: 1, lastSeq: 1 }));
    renderWithProviders(<Probe />);
    await screen.findByText('line 1');
    act(() => screen.getByRole('button', { name: 'clear-a' }).click());
    await waitFor(() => expect(screen.queryByText('line 1')).toBeNull());
    expect(bridge.callsTo('tools:invoke')).toContainEqual(expect.objectContaining({ method: 'clearLogs' }));
  });

  it('reports an error status when the snapshot fails', async () => {
    installMockBridge({});
    renderWithProviders(<Probe />);
    await waitFor(() => expect(screen.getByTestId('status-a')).toHaveTextContent('error'));
  });
});
