import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { queryKeys } from '@/lib/queries';
import { useToolEvent } from '@/lib/tool-events';

export const depsResultsKey = (projectId: string) => queryKeys.tool('deps', projectId, 'results');

/** The last results (from main's cache; no network). Never starts a check. */
export function useDepsResults(projectId: string) {
  const queryClient = useQueryClient();
  useToolEvent(
    'deps',
    projectId,
    'changed',
    () => void queryClient.invalidateQueries({ queryKey: depsResultsKey(projectId) }),
  );
  return useQuery({
    queryKey: depsResultsKey(projectId),
    queryFn: () => api.tools.invoke('deps', projectId, 'results', {}),
  });
}

export function useDepsActions(projectId: string) {
  const queryClient = useQueryClient();
  return {
    check: useMutation({
      mutationFn: () => api.tools.invoke('deps', projectId, 'check', {}),
      onSuccess: (results) => {
        queryClient.setQueryData(depsResultsKey(projectId), results);
        // The root's card and the Dependencies page read the same results.
        void queryClient.invalidateQueries({ queryKey: ['tool', 'deps'] });
        void queryClient.invalidateQueries({ queryKey: ['deps', 'overview'] });
      },
      onError: (error) => toast.error(errorMessage(error)),
    }),
    copy: useMutation({
      mutationFn: (input: { relPath: string; name: string }) =>
        api.tools.invoke('deps', projectId, 'copyUpdateCommand', input),
      onSuccess: ({ command }) => toast.success(`Copied: ${command}`),
      onError: (error) => toast.error(errorMessage(error)),
    }),
  };
}
