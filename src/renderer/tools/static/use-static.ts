import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ServerConfig } from '@shared/tools/static/contract';
import type { LogSource } from '@/components/log/log-source';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { queryKeys } from '@/lib/queries';
import { subscribeToolEvent, useToolEvent } from '@/lib/tool-events';

const statusKey = (projectId: string) => queryKeys.tool('static', projectId, 'status');
const configKey = (projectId: string) => queryKeys.tool('static', projectId, 'config');
const runningKey = queryKeys.tool('static', '*', 'running');

/** Server status, refetched when the server starts or stops. */
export function useStaticStatus(projectId: string) {
  const queryClient = useQueryClient();
  useToolEvent('static', projectId, 'changed', () => {
    void queryClient.invalidateQueries({ queryKey: statusKey(projectId) });
    void queryClient.invalidateQueries({ queryKey: runningKey });
  });
  return useQuery({ queryKey: statusKey(projectId), queryFn: () => api.tools.invoke('static', projectId, 'status', {}) });
}

export function useStaticConfig(projectId: string) {
  return useQuery({ queryKey: configKey(projectId), queryFn: () => api.tools.invoke('static', projectId, 'config', {}) });
}

/** Every running server across projects (any project id answers; the list is global). */
export function useRunningServers(projectId: string) {
  return useQuery({ queryKey: runningKey, queryFn: () => api.tools.invoke('static', projectId, 'running', {}) });
}

export function useStaticActions(projectId: string) {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: statusKey(projectId) }),
      queryClient.invalidateQueries({ queryKey: configKey(projectId) }),
      queryClient.invalidateQueries({ queryKey: runningKey }),
    ]);
  const onError = (error: unknown) => toast.error(errorMessage(error));
  return {
    setConfig: useMutation({
      mutationFn: (config: ServerConfig) => api.tools.invoke('static', projectId, 'setConfig', { config }),
      onSettled: refresh,
      onError,
    }),
    start: useMutation({ mutationFn: () => api.tools.invoke('static', projectId, 'start', {}), onSettled: refresh }),
    stop: useMutation({ mutationFn: () => api.tools.invoke('static', projectId, 'stop', {}), onSettled: refresh, onError }),
  };
}

/** The request log: snapshots from getLogs, batches from the 'logs' event. */
export function staticLogSource(projectId: string): LogSource {
  return {
    key: JSON.stringify(['static', projectId]),
    snapshot: (afterSeq) => api.tools.invoke('static', projectId, 'getLogs', afterSeq === undefined ? {} : { afterSeq }),
    subscribe: (onLines) => subscribeToolEvent('static', projectId, 'logs', (payload) => onLines(payload.lines)),
    clear: async () => {
      await api.tools.invoke('static', projectId, 'clearLogs', {});
    },
  };
}
