import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useUiStore } from '@/state/ui-store';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { useNavigateSubscription } from './navigate';

function Navigator() {
  useNavigateSubscription();
  return null;
}

describe('useNavigateSubscription: settings', () => {
  it('opens Settings when the app menu asks', async () => {
    const bridge = installMockBridge({});
    renderWithProviders(<Navigator />);
    act(() => bridge.emit('app:openSettings'));
    await waitFor(() => expect(useUiStore.getState().settingsOpen).toBe(true));
  });
});
