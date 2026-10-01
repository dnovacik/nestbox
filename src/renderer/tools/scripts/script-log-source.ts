import { api } from '@/lib/api';
import { subscribeToolEvent } from '@/lib/tool-events';
import type { LogSource } from '@/components/log/log-source';

/** A script's output: snapshots from the scripts tool's getLogs, batches from its 'logs' events. */
export function scriptLogSource(projectId: string, script: string): LogSource {
  return {
    key: JSON.stringify(['scripts', projectId, script]),
    snapshot: (afterSeq) =>
      api.tools.invoke('scripts', projectId, 'getLogs', afterSeq === undefined ? { script } : { script, afterSeq }),
    subscribe: (onLines) =>
      subscribeToolEvent('scripts', projectId, 'logs', (payload) => {
        if (payload.script === script) onLines(payload.lines);
      }),
    clear: async () => {
      await api.tools.invoke('scripts', projectId, 'clearLogs', { script });
    },
  };
}
