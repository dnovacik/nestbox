import { useEffect } from 'react';
import { NavigateSchema } from '@shared/processes';
import { useUiStore } from '@/state/ui-store';
import { api } from './api';

/** Main asks to show a project tab (tray "Show logs", a crash notification). */
export function useNavigateSubscription(): void {
  useEffect(
    () =>
      api.on('app:navigate', (raw) => {
        const parsed = NavigateSchema.safeParse(raw);
        if (!parsed.success) return;
        const { projectId, tab, script } = parsed.data;
        const ui = useUiStore.getState();
        ui.select(projectId);
        ui.setActiveTab(projectId, tab);
        if (script !== undefined) ui.showScript(projectId, script);
      }),
    [],
  );
}
