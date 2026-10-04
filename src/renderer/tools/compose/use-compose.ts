import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';
import type { ComposeAction } from '@shared/tools/compose/contract';
import type { LogSource } from '@/components/log/log-source';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { queryKeys } from '@/lib/queries';
import { subscribeToolEvent, useToolEvent } from '@/lib/tool-events';

export const composeStatusKey = (projectId: string) =>
  queryKeys.tool('compose', projectId, 'status');
export const COMPOSE_POLL_MS = 3_000;

const ACTION_LABEL: Record<ComposeAction, string> = {
  up: 'Up',
  stop: 'Stop',
  restart: 'Restart',
  down: 'Down',
};

/** Services and their state: polled every 3 s while a card or panel is mounted, and after every change. */
export function useComposeStatus(projectId: string) {
  const queryClient = useQueryClient();
  useToolEvent(
    'compose',
    projectId,
    'changed',
    () => void queryClient.invalidateQueries({ queryKey: composeStatusKey(projectId) }),
  );
  return useQuery({
    queryKey: composeStatusKey(projectId),
    queryFn: () => api.tools.invoke('compose', projectId, 'status', {}),
    staleTime: 0,
    refetchInterval: COMPOSE_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

export function useComposeAction(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ action, service }: { action: ComposeAction; service?: string }) => {
      const input = service === undefined ? {} : { service };
      const result =
        action === 'down'
          ? await api.tools.invoke('compose', projectId, 'down', {})
          : action === 'restart'
            ? await api.tools.invoke('compose', projectId, 'restart', { service: service ?? '' })
            : await api.tools.invoke('compose', projectId, action, input);
      return { action, result };
    },
    onSuccess: ({ action, result }) => {
      if (!result.ok)
        toast.error(
          `${ACTION_LABEL[action]} failed${result.code === null ? '' : ` (exit ${result.code})`}: see Actions`,
        );
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: composeStatusKey(projectId) }),
  });
}

/** Follows service while it is set, and stops following when it changes or the caller unmounts. */
export function useFollow(projectId: string, service: string | null) {
  useEffect(() => {
    if (service === null) return;
    api.tools
      .invoke('compose', projectId, 'follow', { service })
      .catch((error: unknown) => toast.error(errorMessage(error)));
    return () => {
      void api.tools.invoke('compose', projectId, 'unfollow', {}).catch(() => undefined);
    };
  }, [projectId, service]);
}

/** The Actions log, or the followed service's log (its key changes with the service, so the view reloads). */
export function composeLogSource(projectId: string, service: string | null): LogSource {
  const source = service === null ? 'actions' : 'service';
  return {
    key: JSON.stringify(['compose', projectId, source, service]),
    snapshot: (afterSeq) =>
      api.tools.invoke(
        'compose',
        projectId,
        'getLogs',
        afterSeq === undefined ? { source } : { source, afterSeq },
      ),
    subscribe: (onLines) =>
      subscribeToolEvent('compose', projectId, 'logs', (payload) => {
        if (payload.source === source) onLines(payload.lines);
      }),
    clear: async () => {
      await api.tools.invoke('compose', projectId, 'clearLogs', { source });
    },
  };
}
