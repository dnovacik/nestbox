import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { resolveTheme, useAppliedTheme } from './use-applied-theme';

describe('resolveTheme', () => {
  it('follows the system only for System', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('useAppliedTheme', () => {
  afterEach(() => {
    delete document.documentElement.dataset['theme'];
  });

  it('puts the setting on <html data-theme>', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    installMockBridge({ 'settings:get': (() => ({ theme: 'light' })) as never });
    function Probe() {
      useAppliedTheme();
      return null;
    }
    renderWithProviders(<Probe />);
    await waitFor(() => expect(document.documentElement.dataset['theme']).toBe('light'));
    vi.unstubAllGlobals();
  });
});
