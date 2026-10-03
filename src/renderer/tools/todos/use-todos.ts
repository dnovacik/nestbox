import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { queryKeys } from '@/lib/queries';

export const todosResultsKey = (projectId: string) => queryKeys.tool('todos', projectId, 'results');
export const todosTagsKey = (projectId: string) => queryKeys.tool('todos', projectId, 'tags');

/**
 * The last scan of this session. The first time a package is viewed (no result yet) it starts a scan;
 * after that only Refresh does. Main shares a running scan, so a card and a panel together scan once.
 */
export function useTodos(projectId: string) {
  const queryClient = useQueryClient();
  const results = useQuery({ queryKey: todosResultsKey(projectId), queryFn: () => api.tools.invoke('todos', projectId, 'results', {}) });
  const scan = useMutation({
    mutationFn: () => api.tools.invoke('todos', projectId, 'scan', {}),
    onSuccess: (result) => queryClient.setQueryData(todosResultsKey(projectId), result),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const needsFirstScan = results.data === null && !scan.isPending && !scan.isError;
  const { mutate } = scan;
  useEffect(() => {
    if (needsFirstScan) mutate();
  }, [needsFirstScan, mutate]);
  return { result: results.data ?? null, isError: results.isError, scanning: scan.isPending || needsFirstScan, refresh: () => scan.mutate() };
}

export function useTodoTags(projectId: string) {
  const queryClient = useQueryClient();
  const tags = useQuery({ queryKey: todosTagsKey(projectId), queryFn: () => api.tools.invoke('todos', projectId, 'getTags', {}) });
  const setTags = useMutation({
    mutationFn: (next: string[]) => api.tools.invoke('todos', projectId, 'setTags', { tags: next }),
    onSuccess: (saved) => {
      queryClient.setQueryData(todosTagsKey(projectId), saved);
      // Main dropped the old result: the next read is null, which starts a new scan.
      void queryClient.invalidateQueries({ queryKey: todosResultsKey(projectId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return { tags: tags.data ?? [], setTags };
}

export function useOpenTodo(projectId: string) {
  return useMutation({
    mutationFn: ({ path, line }: { path: string; line: number }) => api.tools.invoke('todos', projectId, 'openFile', { path, line }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}
