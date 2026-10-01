import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { WORKSPACE_ID_SEPARATOR } from '@shared/detected';
import type { SettingsPatch } from '@shared/settings';
import { useUiStore } from '@/state/ui-store';
import { api } from './api';
import { errorMessage } from './errors';

export const queryKeys = {
  projects: ['projects'] as const,
  appInfo: ['app-info'] as const,
  settings: ['settings'] as const,
  processes: ['processes'] as const,
  ports: ['ports'] as const,
  tools: (projectId: string) => ['tools', projectId] as const,
  toolCalls: ['tool'] as const,
  tool: (toolId: string, projectId: string, method: string) => ['tool', toolId, projectId, method] as const,
};

const showError = (error: unknown): void => {
  toast.error(errorMessage(error));
};

export function useProjects() {
  return useQuery({ queryKey: queryKeys.projects, queryFn: () => api.projects.list() });
}

export function useAppInfo() {
  return useQuery({ queryKey: queryKeys.appInfo, queryFn: () => api.app.getInfo(), staleTime: Infinity });
}

export function useProcesses() {
  return useQuery({ queryKey: queryKeys.processes, queryFn: () => api.processes.list() });
}

export function useStopAll() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => api.processes.stopAll(projectId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.processes }),
    onError: showError,
  });
}

/** Main pushes processes:changed (throttled) whenever a process changes state. */
export function useProcessesChangedSubscription(): void {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      api.on('processes:changed', () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.processes });
      }),
    [queryClient],
  );
}

export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: () => api.settings.get() });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) => api.settings.update(patch),
    onSuccess: (view) => queryClient.setQueryData(queryKeys.settings, view),
    onError: showError,
  });
}

export function useTools(projectId: string | null) {
  return useQuery({
    queryKey: queryKeys.tools(projectId ?? ''),
    queryFn: () => api.tools.list(projectId ?? ''),
    enabled: projectId !== null,
  });
}

function useInvalidateProjects() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.projects });
}

export function useAddProject() {
  const invalidate = useInvalidateProjects();
  const select = useUiStore((s) => s.select);
  return useMutation({
    mutationFn: async () => {
      const path = await api.dialog.pickFolder();
      return path === null ? null : api.projects.add(path);
    },
    onSuccess: async (added) => {
      if (!added) return;
      select(added.id);
      await invalidate();
    },
    onError: showError,
  });
}

export function useRemoveProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (id: string) => api.projects.remove(id),
    onSuccess: async (_data, id) => {
      const { selectedProjectId, select } = useUiStore.getState();
      if (selectedProjectId && (selectedProjectId === id || selectedProjectId.startsWith(`${id}${WORKSPACE_ID_SEPARATOR}`))) select(null);
      await invalidate();
    },
    onError: showError,
  });
}

export function useRenameProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.projects.rename(id, name),
    onSuccess: () => invalidate(),
    onError: showError,
  });
}

export function useSetPinned() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => api.projects.setPinned(id, pinned),
    onSuccess: () => invalidate(),
    onError: showError,
  });
}

export function useRefreshProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.projects.refresh(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
        queryClient.invalidateQueries({ queryKey: ['tools'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.toolCalls }),
      ]);
    },
    onError: showError,
  });
}

export function useOpenInEditor() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (id: string) => api.projects.openInEditor(id),
    onError: async (error) => {
      showError(error);
      await invalidate();
    },
  });
}

export function useOpenTerminal() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (id: string) => api.projects.openTerminal(id),
    onError: async (error) => {
      showError(error);
      await invalidate();
    },
  });
}

/** Main pushes projects:changed after any project mutation or refresh. */
export function useProjectsChangedSubscription(): void {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      api.on('projects:changed', () => {
        // Detection results feed tool lists and tool data (scripts, facts), so all three go stale together.
        void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
        void queryClient.invalidateQueries({ queryKey: ['tools'] });
        void queryClient.invalidateQueries({ queryKey: queryKeys.toolCalls });
      }),
    [queryClient],
  );
}
