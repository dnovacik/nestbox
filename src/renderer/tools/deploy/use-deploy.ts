import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { findDetected, splitProjectId } from '@shared/detected';
import {
  type DeployPlatform,
  type DeployTarget,
  PLATFORM_LABELS,
} from '@shared/tools/deploy/contract';
import type { LogSource } from '@/components/log/log-source';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { queryKeys, useProjects } from '@/lib/queries';
import { subscribeToolEvent, useToolEvent } from '@/lib/tool-events';

export const deployStatusKey = (projectId: string) => queryKeys.tool('deploy', projectId, 'status');
export const deploymentsKey = (projectId: string, platform: DeployPlatform) =>
  [...queryKeys.tool('deploy', projectId, 'deployments'), platform] as const;
/** A listing runs the platform's CLI (network): reopening the tab within this time reuses it. */
export const LISTING_STALE_MS = 30_000;

/** Local facts only (config files and PATH), refreshed on every change event. */
export function useDeployStatus(projectId: string) {
  const queryClient = useQueryClient();
  useToolEvent(
    'deploy',
    projectId,
    'changed',
    () => void queryClient.invalidateQueries({ queryKey: deployStatusKey(projectId) }),
  );
  return useQuery({
    queryKey: deployStatusKey(projectId),
    queryFn: () => api.tools.invoke('deploy', projectId, 'status', {}),
    staleTime: 0,
  });
}

/** Recent deployments: runs when the tab shows the platform, and on Refresh. */
export function useDeployments(projectId: string, platform: DeployPlatform, enabled: boolean) {
  return useQuery({
    queryKey: deploymentsKey(projectId, platform),
    queryFn: () => api.tools.invoke('deploy', projectId, 'deployments', { platform }),
    staleTime: LISTING_STALE_MS,
    refetchOnWindowFocus: false,
    retry: false,
    enabled,
  });
}

export function useDeploy(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      platform,
      target,
    }: {
      platform: DeployPlatform;
      target: DeployTarget;
    }) => {
      const result = await api.tools.invoke(
        'deploy',
        projectId,
        'deploy',
        target === 'production' ? { platform, target, confirmed: true } : { platform, target },
      );
      return { platform, result };
    },
    onSuccess: ({ platform, result }) => {
      if (result.ok) toast.success(`Deployed to ${PLATFORM_LABELS[platform]}`);
      else if (result.code !== null)
        toast.error(`Deploy failed (exit ${result.code}): see the log`);
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: (_data, _error, { platform }) => {
      void queryClient.invalidateQueries({ queryKey: deployStatusKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: deploymentsKey(projectId, platform) });
    },
  });
}

/** Login, link and cancel: fire and forget, errors toasted. */
export function useDeployCommand(projectId: string) {
  return useMutation({
    mutationFn: async (
      input: { method: 'login' | 'link'; platform: DeployPlatform } | { method: 'cancel' },
    ) => {
      if (input.method === 'cancel') await api.tools.invoke('deploy', projectId, 'cancel', {});
      else await api.tools.invoke('deploy', projectId, input.method, { platform: input.platform });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

/** The package's name as the sidebar shows it, for the production confirmation. */
export function usePackageName(projectId: string): string {
  const { data: projects } = useProjects();
  const root = projects?.find((p) => p.id === splitProjectId(projectId).rootId);
  if (!root) return 'this package';
  const detected = findDetected(root.detected, projectId);
  return detected && detected.relPath !== '' ? detected.name : root.name;
}

export function deployLogSource(projectId: string): LogSource {
  return {
    key: JSON.stringify(['deploy', projectId]),
    snapshot: (afterSeq) =>
      api.tools.invoke('deploy', projectId, 'getLogs', afterSeq === undefined ? {} : { afterSeq }),
    subscribe: (onLines) =>
      subscribeToolEvent('deploy', projectId, 'logs', (payload) => onLines(payload.lines)),
    clear: async () => {
      await api.tools.invoke('deploy', projectId, 'clearLogs', {});
    },
  };
}
