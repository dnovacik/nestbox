import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { queryKeys } from '@/lib/queries';
import { useToolEvent } from '@/lib/tool-events';

export const gitStatusKey = (projectId: string) => queryKeys.tool('git', projectId, 'status');

/**
 * The repository summary. Refetched when main reports a change under .git, and when the window regains
 * focus: edits made in the editor change the working tree, which nothing watches.
 */
export function useGitStatus(projectId: string, enabled = true) {
  const queryClient = useQueryClient();
  useToolEvent('git', projectId, 'changed', () => void queryClient.invalidateQueries({ queryKey: gitStatusKey(projectId) }));
  useEffect(() => {
    const onFocus = () => void queryClient.invalidateQueries({ queryKey: gitStatusKey(projectId) });
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [queryClient, projectId]);
  return useQuery({ queryKey: gitStatusKey(projectId), queryFn: () => api.tools.invoke('git', projectId, 'status', {}), enabled });
}

export function useOpenGitFile(projectId: string) {
  return useMutation({
    mutationFn: (path: string) => api.tools.invoke('git', projectId, 'openFile', { path }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}
