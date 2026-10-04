import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SendInput } from '@shared/tools/inspector/contract';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { queryKeys } from '@/lib/queries';
import { useToolEvent } from '@/lib/tool-events';

export const inspectorStatusKey = (projectId: string) =>
  queryKeys.tool('inspector', projectId, 'status');
export const inspectorConfigKey = (projectId: string) =>
  queryKeys.tool('inspector', projectId, 'config');
export const inspectorListKey = (projectId: string) =>
  queryKeys.tool('inspector', projectId, 'list');
export const inspectorEntryKey = (projectId: string, id: string) =>
  queryKeys.tool('inspector', projectId, `entry:${id}`);

/** Status, settings and the recorded requests, refreshed by main's events. */
export function useInspector(projectId: string) {
  const queryClient = useQueryClient();
  useToolEvent('inspector', projectId, 'changed', () => {
    void queryClient.invalidateQueries({ queryKey: inspectorStatusKey(projectId) });
    void queryClient.invalidateQueries({ queryKey: inspectorConfigKey(projectId) });
  });
  useToolEvent('inspector', projectId, 'entries', () => {
    void queryClient.invalidateQueries({ queryKey: inspectorListKey(projectId) });
    void queryClient.invalidateQueries({ queryKey: inspectorStatusKey(projectId) });
  });
  // The target can come from PORT in .env.
  useToolEvent(
    'env',
    projectId,
    'changed',
    () => void queryClient.invalidateQueries({ queryKey: inspectorStatusKey(projectId) }),
  );
  const status = useQuery({
    queryKey: inspectorStatusKey(projectId),
    queryFn: () => api.tools.invoke('inspector', projectId, 'status', {}),
    staleTime: 0,
  });
  const config = useQuery({
    queryKey: inspectorConfigKey(projectId),
    queryFn: () => api.tools.invoke('inspector', projectId, 'config', {}),
  });
  const list = useQuery({
    queryKey: inspectorListKey(projectId),
    queryFn: () => api.tools.invoke('inspector', projectId, 'list', {}),
    staleTime: 0,
  });
  return {
    status: status.data ?? null,
    config: config.data ?? null,
    entries: list.data ?? [],
    isError: status.isError || config.isError,
  };
}

export function useInspectorEntry(projectId: string, id: string | null) {
  return useQuery({
    queryKey: inspectorEntryKey(projectId, id ?? ''),
    queryFn: () => api.tools.invoke('inspector', projectId, 'get', { id: id ?? '' }),
    enabled: id !== null,
    // A recorded entry never changes.
    staleTime: Infinity,
    retry: false,
  });
}

export function useInspectorActions(projectId: string) {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: inspectorStatusKey(projectId) }),
      queryClient.invalidateQueries({ queryKey: inspectorConfigKey(projectId) }),
      queryClient.invalidateQueries({ queryKey: inspectorListKey(projectId) }),
    ]);
  const onError = (error: unknown) => toast.error(errorMessage(error));
  return {
    setOptions: useMutation({
      mutationFn: (options: { port?: number | null; target?: string | null }) =>
        api.tools.invoke('inspector', projectId, 'setOptions', options),
      onSettled: refresh,
      onError,
    }),
    /** Errors are the caller's: a busy port offers the next free one. */
    start: useMutation({
      mutationFn: () => api.tools.invoke('inspector', projectId, 'start', {}),
      onSettled: refresh,
    }),
    stop: useMutation({
      mutationFn: () => api.tools.invoke('inspector', projectId, 'stop', {}),
      onSettled: refresh,
      onError,
    }),
    replay: useMutation({
      mutationFn: (id: string) => api.tools.invoke('inspector', projectId, 'replay', { id }),
      onSettled: refresh,
      onError,
    }),
    send: useMutation({
      mutationFn: (input: SendInput) => api.tools.invoke('inspector', projectId, 'send', input),
      onSettled: refresh,
      onError,
    }),
    copyCurl: useMutation({
      mutationFn: (id: string) => api.tools.invoke('inspector', projectId, 'copyCurl', { id }),
      onSuccess: () => toast.success('Copied as curl'),
      onError,
    }),
    clear: useMutation({
      mutationFn: () => api.tools.invoke('inspector', projectId, 'clear', {}),
      onSettled: refresh,
      onError,
    }),
  };
}

export function revealHeader(
  projectId: string,
  id: string,
  side: 'request' | 'response',
  name: string,
): Promise<string> {
  return api.tools
    .invoke('inspector', projectId, 'reveal', { id, side, name })
    .then((r) => r.value);
}
