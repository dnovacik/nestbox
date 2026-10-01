import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ClaudeDoc } from '@shared/tools/claude/contract';
import type { LogSource } from '@/components/log/log-source';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { queryKeys } from '@/lib/queries';
import { subscribeToolEvent, useToolEvent } from '@/lib/tool-events';

const statusKey = (projectId: string) => queryKeys.tool('claude', projectId, 'status');
export const docKey = (projectId: string, file: ClaudeDoc) => [...queryKeys.tool('claude', projectId, 'readDoc'), file] as const;

/** Readiness: CLI, .claude files, gitignore, prompt running. Refetched when a prompt starts or ends. */
export function useClaudeStatus(projectId: string) {
  const queryClient = useQueryClient();
  useToolEvent('claude', projectId, 'changed', () => void queryClient.invalidateQueries({ queryKey: statusKey(projectId) }));
  return useQuery({ queryKey: statusKey(projectId), queryFn: () => api.tools.invoke('claude', projectId, 'status', {}) });
}

export function useClaudeDoc(projectId: string, file: ClaudeDoc) {
  return useQuery({ queryKey: docKey(projectId, file), queryFn: () => api.tools.invoke('claude', projectId, 'readDoc', { file }) });
}

export function useClaudeActions(projectId: string) {
  const queryClient = useQueryClient();
  const onError = (error: unknown) => toast.error(errorMessage(error));
  const refreshStatus = () => queryClient.invalidateQueries({ queryKey: statusKey(projectId) });
  return {
    open: useMutation({ mutationFn: () => api.tools.invoke('claude', projectId, 'open', {}), onError }),
    continue: useMutation({ mutationFn: () => api.tools.invoke('claude', projectId, 'continue', {}), onError }),
    prompt: useMutation({ mutationFn: (text: string) => api.tools.invoke('claude', projectId, 'prompt', { text }), onError, onSettled: refreshStatus }),
    stopPrompt: useMutation({ mutationFn: () => api.tools.invoke('claude', projectId, 'stopPrompt', {}), onError }),
  };
}

/** Output of `claude -p` runs: snapshots from getPromptLogs, batches from the 'logs' event. */
export function claudeLogSource(projectId: string): LogSource {
  return {
    key: JSON.stringify(['claude', projectId]),
    snapshot: (afterSeq) => api.tools.invoke('claude', projectId, 'getPromptLogs', afterSeq === undefined ? {} : { afterSeq }),
    subscribe: (onLines) => subscribeToolEvent('claude', projectId, 'logs', (payload) => onLines(payload.lines)),
    clear: async () => {
      await api.tools.invoke('claude', projectId, 'clearPromptLogs', {});
    },
  };
}
