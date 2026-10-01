import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PortKillInput, PortRow } from '@shared/ports';
import { belongsTo } from '@shared/processes';
import { api } from './api';
import { queryKeys } from './queries';

/** How often a visible Ports page or card refreshes. Main shares one scan between callers within a second. */
export const PORTS_POLL_MS = 3_000;

/** The machine's listening ports, polled while a component using it is mounted and the window is visible. */
export function usePorts(enabled = true) {
  return useQuery({
    queryKey: queryKeys.ports,
    queryFn: () => api.ports.list(),
    enabled,
    refetchInterval: PORTS_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

export function useKillPort() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PortKillInput) => api.ports.kill(input),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.ports }),
        queryClient.invalidateQueries({ queryKey: queryKeys.processes }),
      ]),
  });
}

/** Rows owned by scripts of the project or its workspace packages. */
export function portsForProject(rows: readonly PortRow[], projectId: string): PortRow[] {
  return rows.filter((r) => r.owner !== null && belongsTo(r.owner.projectId, projectId));
}
