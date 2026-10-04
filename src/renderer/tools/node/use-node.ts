import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { NodeStatus } from '@shared/tools/node/contract';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { queryKeys } from '@/lib/queries';

export const nodeStatusKey = (projectId: string) => queryKeys.tool('node', projectId, 'status');

/** The Node check; main caches it for 30 s, so the renderer keeps it as long. */
export function useNodeStatus(projectId: string) {
  return useQuery({
    queryKey: nodeStatusKey(projectId),
    queryFn: () => api.tools.invoke('node', projectId, 'status', {}),
    staleTime: 30_000,
  });
}

export function useNodeActions(projectId: string) {
  const queryClient = useQueryClient();
  const put = (status: NodeStatus) => queryClient.setQueryData(nodeStatusKey(projectId), status);
  const onError = (error: unknown) => toast.error(errorMessage(error));
  return {
    refresh: useMutation({
      mutationFn: () => api.tools.invoke('node', projectId, 'refresh', {}),
      onSuccess: put,
      onError,
    }),
    setFnm: useMutation({
      mutationFn: (enabled: boolean) => api.tools.invoke('node', projectId, 'setFnm', { enabled }),
      onSuccess: (status) => {
        put(status);
        // The switch is the root project's: its workspace packages' checks changed too.
        void queryClient.invalidateQueries({ queryKey: ['tool', 'node'] });
      },
      onError,
    }),
  };
}
