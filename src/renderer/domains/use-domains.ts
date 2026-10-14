import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';
import type { DomainsStatus } from '@shared/domains';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { queryKeys } from '@/lib/queries';

/** The domains status; main pushes domains:changed when routes, servers or trust change. */
export function useDomainsStatus() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      api.on(
        'domains:changed',
        () => void queryClient.invalidateQueries({ queryKey: queryKeys.domains }),
      ),
    [queryClient],
  );
  return useQuery({ queryKey: queryKeys.domains, queryFn: () => api.domains.status() });
}

export function useDomainsActions() {
  const queryClient = useQueryClient();
  const put = (status: DomainsStatus) => queryClient.setQueryData(queryKeys.domains, status);
  const refetch = () => void queryClient.invalidateQueries({ queryKey: queryKeys.domains });
  const onError = (error: unknown) => toast.error(errorMessage(error));
  return {
    setEnabled: useMutation({
      mutationFn: (enabled: boolean) => api.domains.setEnabled(enabled),
      onSuccess: put,
      onError,
    }),
    setPorts: useMutation({
      mutationFn: (p: { httpPort: number; httpsPort: number }) =>
        api.domains.setPorts(p.httpPort, p.httpsPort),
      onSuccess: put,
      onError,
    }),
    setName: useMutation({
      mutationFn: (i: { projectId: string; label: string | null }) =>
        api.domains.setName(i.projectId, i.label),
      onSuccess: put,
      onError,
    }),
    setRewriteHost: useMutation({
      mutationFn: (i: { projectId: string; rewrite: boolean }) =>
        api.domains.setRewriteHost(i.projectId, i.rewrite),
      onSuccess: put,
      onError,
    }),
    trust: useMutation({ mutationFn: () => api.domains.trustCa(), onSettled: refetch, onError }),
    remove: useMutation({ mutationFn: () => api.domains.removeCa(), onSettled: refetch, onError }),
  };
}
