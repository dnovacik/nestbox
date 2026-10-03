import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';
import type { PrismaCommand } from '@shared/tools/database/contract';
import type { LogSource } from '@/components/log/log-source';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { queryKeys } from '@/lib/queries';
import { subscribeToolEvent, useToolEvent } from '@/lib/tool-events';

export const databaseStatusKey = (projectId: string) => queryKeys.tool('database', projectId, 'status');

/**
 * Where DATABASE_URL points and whether it answers. Refetched when a command starts or stops, when the
 * env tool changes a .env file of the same package (an edit or a profile switch), and on window focus
 * (a database started outside NestBox).
 */
export function useDatabaseStatus(projectId: string) {
  const queryClient = useQueryClient();
  const refetch = () => void queryClient.invalidateQueries({ queryKey: databaseStatusKey(projectId) });
  useToolEvent('database', projectId, 'changed', refetch);
  useToolEvent('env', projectId, 'changed', refetch);
  useEffect(() => {
    const onFocus = () => void queryClient.invalidateQueries({ queryKey: databaseStatusKey(projectId) });
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [queryClient, projectId]);
  return useQuery({ queryKey: databaseStatusKey(projectId), queryFn: () => api.tools.invoke('database', projectId, 'status', {}) });
}

export function useDatabaseActions(projectId: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: databaseStatusKey(projectId) });
  const onError = (error: unknown) => toast.error(errorMessage(error));
  return {
    testLogin: useMutation({ mutationFn: () => api.tools.invoke('database', projectId, 'testLogin', {}), onSettled: refresh, onError }),
    run: useMutation({
      mutationFn: (command: PrismaCommand) => api.tools.invoke('database', projectId, 'run', { command }),
      onSettled: refresh,
      onError,
    }),
    stop: useMutation({
      mutationFn: (what: 'command' | 'studio') => api.tools.invoke('database', projectId, 'stop', { what }),
      onSettled: refresh,
      onError,
    }),
    migrateDev: useMutation({ mutationFn: () => api.tools.invoke('database', projectId, 'migrateDev', {}), onError }),
    startStudio: useMutation({ mutationFn: () => api.tools.invoke('database', projectId, 'startStudio', {}), onSettled: refresh, onError }),
  };
}

/** Prisma command output: snapshots from getLogs, batches from the 'logs' event. */
export function databaseLogSource(projectId: string): LogSource {
  return {
    key: JSON.stringify(['database', projectId]),
    snapshot: (afterSeq) => api.tools.invoke('database', projectId, 'getLogs', afterSeq === undefined ? {} : { afterSeq }),
    subscribe: (onLines) => subscribeToolEvent('database', projectId, 'logs', (payload) => onLines(payload.lines)),
    clear: async () => {
      await api.tools.invoke('database', projectId, 'clearLogs', {});
    },
  };
}
