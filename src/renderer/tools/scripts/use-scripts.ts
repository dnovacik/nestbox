import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { RunGroup } from '@shared/types';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { queryKeys } from '@/lib/queries';

const showError = (error: unknown): void => {
  toast.error(errorMessage(error));
};

export const scriptListKey = (projectId: string) => queryKeys.tool('scripts', projectId, 'list');

export function useScriptList(projectId: string) {
  return useQuery({
    queryKey: scriptListKey(projectId),
    queryFn: () => api.tools.invoke('scripts', projectId, 'list', {}),
  });
}

function useRefreshAfter(projectId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.processes }),
      queryClient.invalidateQueries({ queryKey: scriptListKey(projectId) }),
    ]);
}

export type ScriptAction = 'start' | 'stop' | 'restart';

export function useScriptAction(projectId: string) {
  const refresh = useRefreshAfter(projectId);
  return useMutation({
    mutationFn: ({ action, script }: { action: ScriptAction; script: string }) =>
      api.tools.invoke('scripts', projectId, action, { script }),
    onSettled: refresh,
    onError: showError,
  });
}

export function useSetAutoRestart(projectId: string) {
  const refresh = useRefreshAfter(projectId);
  return useMutation({
    mutationFn: ({ script, enabled }: { script: string; enabled: boolean }) =>
      api.tools.invoke('scripts', projectId, 'setAutoRestart', { script, enabled }),
    onSettled: refresh,
    onError: showError,
  });
}

export function useRunGroupActions(projectId: string) {
  const refresh = useRefreshAfter(projectId);
  const save = useMutation({
    mutationFn: (input: { previousName?: string; group: RunGroup }) =>
      api.tools.invoke('scripts', projectId, 'saveRunGroup', input),
    onSuccess: refresh,
    onError: showError,
  });
  const remove = useMutation({
    mutationFn: (name: string) => api.tools.invoke('scripts', projectId, 'deleteRunGroup', { name }),
    onSuccess: refresh,
    onError: showError,
  });
  const start = useMutation({
    mutationFn: (name: string) => api.tools.invoke('scripts', projectId, 'startRunGroup', { name }),
    onSuccess: (result) => {
      if (result.skipped.length > 0) {
        const list = result.skipped
          .map((e) => `${e.relPath === '' ? '' : `${e.relPath} `}${e.script} (${e.reason})`)
          .join(', ');
        toast.warning(`Skipped ${result.skipped.length} ${result.skipped.length === 1 ? 'script' : 'scripts'}: ${list}`);
      }
    },
    onSettled: refresh,
    onError: showError,
  });
  const stop = useMutation({
    mutationFn: (name: string) => api.tools.invoke('scripts', projectId, 'stopRunGroup', { name }),
    onSettled: refresh,
    onError: showError,
  });
  return { save, remove, start, stop };
}

export function useOpenFileAt(projectId: string) {
  return useMutation({
    mutationFn: ({ path, line }: { path: string; line: number }) =>
      api.tools.invoke('scripts', projectId, 'openFileAt', { path, line }),
    onError: showError,
  });
}

export function useExportLogs(projectId: string) {
  return useMutation({
    mutationFn: ({ script, seqs }: { script: string; seqs: number[] | 'all' }) =>
      api.tools.invoke('scripts', projectId, 'exportLogs', { script, seqs }),
    onSuccess: (result) => {
      if (result.saved) toast.success('Log exported');
    },
    onError: showError,
  });
}
