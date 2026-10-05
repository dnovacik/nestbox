import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { type CiJobs, type CiRuns, isActive } from '@shared/tools/ci/contract';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { queryKeys } from '@/lib/queries';
import { useToolEvent } from '@/lib/tool-events';

export type CiScope = 'branch' | 'all';

export const ciStatusKey = (projectId: string) => queryKeys.tool('ci', projectId, 'status');
export const ciRunsKey = (projectId: string, scope: CiScope) =>
  [...queryKeys.tool('ci', projectId, 'runs'), scope] as const;
export const ciJobsKey = (projectId: string, runId: string) =>
  [...queryKeys.tool('ci', projectId, 'jobs'), runId] as const;
const ciLogKey = (projectId: string, runId: string, jobId: string) =>
  [...queryKeys.tool('ci', projectId, 'jobLog'), runId, jobId] as const;

/** A listing runs the provider's CLI (network): reopening the tab within this time reuses it. */
export const LISTING_STALE_MS = 30_000;
/** While a run is queued or running, the open tab refreshes this often. */
export const FOLLOW_MS = 20_000;

const runsActive = (data: CiRuns | undefined) =>
  data?.state === 'ok' && data.runs.some((r) => isActive(r.state));
const jobsActive = (data: CiJobs | undefined) =>
  data?.state === 'ok' && data.jobs.some((j) => isActive(j.state));

/** Local facts only (remote, CLI, branch, the newest run seen), refreshed on every change event. */
export function useCiStatus(projectId: string) {
  const queryClient = useQueryClient();
  useToolEvent(
    'ci',
    projectId,
    'changed',
    () => void queryClient.invalidateQueries({ queryKey: ciStatusKey(projectId) }),
  );
  return useQuery({
    queryKey: ciStatusKey(projectId),
    queryFn: () => api.tools.invoke('ci', projectId, 'status', {}),
    staleTime: 0,
  });
}

export function useCiRuns(projectId: string, scope: CiScope, enabled: boolean) {
  return useQuery({
    queryKey: ciRunsKey(projectId, scope),
    queryFn: () => api.tools.invoke('ci', projectId, 'runs', { scope }),
    staleTime: LISTING_STALE_MS,
    refetchOnWindowFocus: false,
    retry: false,
    enabled,
    refetchInterval: (query) => (runsActive(query.state.data) ? FOLLOW_MS : false),
  });
}

export function useCiJobs(projectId: string, runId: string | null, follow: boolean) {
  return useQuery({
    queryKey: ciJobsKey(projectId, runId ?? ''),
    queryFn: () => api.tools.invoke('ci', projectId, 'jobs', { runId: runId ?? '' }),
    staleTime: LISTING_STALE_MS,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: runId !== null,
    refetchInterval: (query) => (follow || jobsActive(query.state.data) ? FOLLOW_MS : false),
  });
}

/** Fetched only when the user asks for it; never cached for long (it is log text). */
export function useCiJobLog(projectId: string, runId: string, jobId: string, enabled: boolean) {
  return useQuery({
    queryKey: ciLogKey(projectId, runId, jobId),
    queryFn: () => api.tools.invoke('ci', projectId, 'jobLog', { runId, jobId }),
    staleTime: LISTING_STALE_MS,
    gcTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled,
  });
}

export function useRerunFailed(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => api.tools.invoke('ci', projectId, 'rerunFailed', { runId }),
    onSuccess: (result) => {
      if (result.ok)
        toast.success(`Re-running ${result.retried} failed job${result.retried === 1 ? '' : 's'}`);
      else toast.error("Couldn't re-run the failed jobs");
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tool('ci', projectId, 'runs') });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tool('ci', projectId, 'jobs') });
    },
  });
}

export function useCiLogin(projectId: string) {
  return useMutation({
    mutationFn: () => api.tools.invoke('ci', projectId, 'login', {}),
    onError: (error) => toast.error(errorMessage(error)),
  });
}
