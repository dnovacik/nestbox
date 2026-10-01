import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queries';

export function useProjectFacts(projectId: string) {
  return useQuery({
    queryKey: queryKeys.tool('project-info', projectId, 'getFacts'),
    queryFn: () => api.tools.invoke('project-info', projectId, 'getFacts', {}),
  });
}
