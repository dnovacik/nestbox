import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { useModKey } from './platform';

function Key() {
  return <span>key:{useModKey()}</span>;
}

describe('useModKey', () => {
  it('is ⌘ on macOS', async () => {
    installMockBridge({ 'app:getInfo': () => ({ version: '1', platform: 'darwin' }) });
    renderWithProviders(<Key />);
    expect(await screen.findByText('key:⌘')).toBeInTheDocument();
  });

  it('is Ctrl on Windows, and while the platform is unknown', async () => {
    installMockBridge({ 'app:getInfo': () => ({ version: '1', platform: 'win32' }) });
    renderWithProviders(<Key />);
    expect(await screen.findByText('key:Ctrl')).toBeInTheDocument();
  });
});
