import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CheckInput } from '@shared/tools/health/contract';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { queryKeys } from '@/lib/queries';
import { useToolEvent } from '@/lib/tool-events';

export const healthStatusKey = (projectId: string) => queryKeys.tool('health', projectId, 'status');

/** The package's checks and their last results. Main says when results or the live state change. */
export function useHealth(projectId: string) {
  const queryClient = useQueryClient();
  const refetch = () =>
    void queryClient.invalidateQueries({ queryKey: healthStatusKey(projectId) });
  useToolEvent('health', projectId, 'changed', refetch);
  // An env edit can change an env check's target or the suggestions.
  useToolEvent('env', projectId, 'changed', refetch);
  return useQuery({
    queryKey: healthStatusKey(projectId),
    queryFn: () => api.tools.invoke('health', projectId, 'status', {}),
  });
}

export function useHealthActions(projectId: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: healthStatusKey(projectId) });
  const onError = (error: unknown) => toast.error(errorMessage(error));
  return {
    add: useMutation({
      mutationFn: (check: CheckInput) =>
        api.tools.invoke('health', projectId, 'addCheck', { check }),
      onSettled: refresh,
      onError,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.tools.invoke('health', projectId, 'removeCheck', { id }),
      onSettled: refresh,
      onError,
    }),
    setOptions: useMutation({
      mutationFn: (options: { intervalSec?: number; notify?: boolean }) =>
        api.tools.invoke('health', projectId, 'setOptions', options),
      onSettled: refresh,
      onError,
    }),
    checkNow: useMutation({
      mutationFn: () => api.tools.invoke('health', projectId, 'checkNow', {}),
      onSettled: refresh,
      onError,
    }),
  };
}
