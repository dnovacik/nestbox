import { useEffect } from 'react';
import { NavigateSchema } from '@shared/processes';
import { useUiStore } from '@/state/ui-store';
import { api } from './api';

/** Main asks to show a project tab (tray "Show logs", a crash notification) or Settings (the macOS menu). */
export function useNavigateSubscription(): void {
  useEffect(() => {
    const offNavigate = api.on('app:navigate', (raw) => {
      const parsed = NavigateSchema.safeParse(raw);
      if (!parsed.success) return;
      const { projectId, tab, script } = parsed.data;
      const ui = useUiStore.getState();
      ui.select(projectId);
      ui.setActiveTab(projectId, tab);
      if (script !== undefined) ui.showScript(projectId, script);
    });
    // The macOS app menu's Settings… (⌘,).
    const offSettings = api.on('app:openSettings', () => useUiStore.getState().setSettingsOpen(true));
    return () => {
      offNavigate();
      offSettings();
    };
  }, []);
}
