import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { MockRoute, PackageMock } from '@shared/tools/mock/contract';
import type { LogSource } from '@/components/log/log-source';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { queryKeys } from '@/lib/queries';
import { subscribeToolEvent, useToolEvent } from '@/lib/tool-events';

export const mockStatusKey = (projectId: string) => queryKeys.tool('mock', projectId, 'status');
export const mockConfigKey = (projectId: string) => queryKeys.tool('mock', projectId, 'config');

/** Server status and the routes, refetched when main says something changed. */
export function useMock(projectId: string) {
  const queryClient = useQueryClient();
  useToolEvent('mock', projectId, 'changed', () => {
    void queryClient.invalidateQueries({ queryKey: mockStatusKey(projectId) });
    void queryClient.invalidateQueries({ queryKey: mockConfigKey(projectId) });
  });
  const status = useQuery({
    queryKey: mockStatusKey(projectId),
    queryFn: () => api.tools.invoke('mock', projectId, 'status', {}),
    staleTime: 0,
  });
  const config = useQuery({
    queryKey: mockConfigKey(projectId),
    queryFn: () => api.tools.invoke('mock', projectId, 'config', {}),
  });
  return {
    status: status.data ?? null,
    config: config.data ?? null,
    isError: status.isError || config.isError,
  };
}

export function useMockActions(projectId: string) {
  const queryClient = useQueryClient();
  const saved = (config: PackageMock) => queryClient.setQueryData(mockConfigKey(projectId), config);
  const refreshStatus = () => queryClient.invalidateQueries({ queryKey: mockStatusKey(projectId) });
  const onError = (error: unknown) => toast.error(errorMessage(error));
  return {
    saveRoute: useMutation({
      mutationFn: (route: MockRoute) => api.tools.invoke('mock', projectId, 'saveRoute', { route }),
      onSuccess: saved,
      onError,
    }),
    deleteRoute: useMutation({
      mutationFn: (id: string) => api.tools.invoke('mock', projectId, 'deleteRoute', { id }),
      onSuccess: saved,
      onError,
    }),
    moveRoute: useMutation({
      mutationFn: ({ id, to }: { id: string; to: number }) =>
        api.tools.invoke('mock', projectId, 'moveRoute', { id, to }),
      onSuccess: saved,
      onError,
    }),
    setOptions: useMutation({
      mutationFn: (options: {
        port?: number | null;
        delayMs?: number;
        failAll?: { on: boolean; status: number };
      }) => api.tools.invoke('mock', projectId, 'setOptions', options),
      onSuccess: (config) => {
        saved(config);
        void refreshStatus();
      },
      onError,
    }),
    /** Errors are the caller's: a busy port offers the next free one. */
    start: useMutation({
      mutationFn: () => api.tools.invoke('mock', projectId, 'start', {}),
      onSettled: refreshStatus,
    }),
    stop: useMutation({
      mutationFn: () => api.tools.invoke('mock', projectId, 'stop', {}),
      onSettled: refreshStatus,
      onError,
    }),
  };
}

/** The request log: snapshots from getLogs, batches from the 'logs' event. */
export function mockLogSource(projectId: string): LogSource {
  return {
    key: JSON.stringify(['mock', projectId]),
    snapshot: (afterSeq) =>
      api.tools.invoke('mock', projectId, 'getLogs', afterSeq === undefined ? {} : { afterSeq }),
    subscribe: (onLines) =>
      subscribeToolEvent('mock', projectId, 'logs', (payload) => onLines(payload.lines)),
    clear: async () => {
      await api.tools.invoke('mock', projectId, 'clearLogs', {});
    },
  };
}
