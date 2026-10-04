import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

export const depsOverviewKey = ['deps', 'overview'] as const;
const POLL_MS = 3_000;

/** Every project's last results (main's cache; no network). Polls only while checks run, when `live`. */
export function useDepsOverview(live = true) {
  return useQuery({
    queryKey: depsOverviewKey,
    queryFn: () => api.deps.overview(),
    refetchInterval: (query) => {
      const data = query.state.data;
      return live && data && (data.runningAll || data.projects.some((p) => p.checking))
        ? POLL_MS
        : false;
    },
  });
}

export function useCheckAll() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.deps.checkAll(),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: depsOverviewKey }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}
