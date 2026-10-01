import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { installMockBridge } from '@/test/mock-bridge';
import { makeProcess } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { StatusBar } from './StatusBar';

describe('StatusBar', () => {
  it('counts starting and running processes across projects', async () => {
    installMockBridge({
      'processes:list': () => [
        makeProcess({ projectId: 'p1', state: 'running' }),
        makeProcess({ projectId: 'p2', state: 'starting' }),
        makeProcess({ projectId: 'p2', script: 'x', state: 'crashed' }),
        makeProcess({ projectId: 'p3', state: 'stopped' }),
      ],
    });
    renderWithProviders(<StatusBar projectCount={3} />);
    expect(await screen.findByText('2 running')).toBeInTheDocument();
    expect(screen.getByText('3 projects')).toBeInTheDocument();
  });

  it('hides the count when nothing runs', async () => {
    installMockBridge({ 'processes:list': () => [makeProcess({ state: 'exited' })] });
    renderWithProviders(<StatusBar projectCount={1} />);
    expect(await screen.findByText('1 project')).toBeInTheDocument();
    expect(screen.queryByText(/running/)).toBeNull();
  });
});
