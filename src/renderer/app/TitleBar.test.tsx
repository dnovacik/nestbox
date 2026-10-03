import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeDetected, makeSummary } from '@/test/fixtures';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { TitleBar } from './TitleBar';

const ws = makeDetected({ id: 'p1::packages/api', rootId: 'p1', relPath: 'packages/api', name: 'api', git: { branch: 'feat/x', head: null } });
const root = makeDetected({ id: 'p1', name: 'shop', workspaces: [ws], git: { branch: 'main', head: null } });
const summary = makeSummary({ id: 'p1', name: 'shop', detected: root });

function renderBar(node: Parameters<typeof TitleBar>[0]['node'], platform: 'win32' | 'darwin' = 'win32') {
  installMockBridge({ 'app:getInfo': () => ({ version: '1.2.3', platform }) });
  return renderWithProviders(<TitleBar node={node} />);
}

describe('TitleBar', () => {
  it('shows the root project and its branch', async () => {
    renderBar({ summary, detected: root, isWorkspace: false });
    expect(await screen.findByText('v1.2.3')).toBeInTheDocument();
    expect(screen.getByText('shop')).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
  });

  it('shows a workspace as root · package with its branch', async () => {
    renderBar({ summary, detected: ws, isWorkspace: true });
    await screen.findByText('v1.2.3');
    expect(screen.getByText('shop')).toBeInTheDocument();
    expect(screen.getByText('api')).toBeInTheDocument();
    expect(screen.getByText('feat/x')).toBeInTheDocument();
  });

  it('shows no project without a selection', async () => {
    renderBar(null);
    await screen.findByText('v1.2.3');
    expect(screen.queryByText('shop')).toBeNull();
  });

  it('leaves room for the macOS traffic lights', async () => {
    renderBar(null, 'darwin');
    await screen.findByText('v1.2.3');
    expect(screen.getByRole('banner')).toHaveStyle({ paddingLeft: '78px' });
  });
});
