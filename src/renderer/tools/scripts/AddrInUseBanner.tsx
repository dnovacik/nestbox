import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { usePorts } from '@/lib/ports';
import { usePortKiller } from '@/ports/use-port-killer';
import { useScriptAction } from './use-scripts';

/** How long to wait for a killed process to release its port before giving up on the restart. */
const FREE_TIMEOUT_MS = 5_000;

interface Props {
  projectId: string;
  script: string;
  port: number;
}

/** Shown in a log pane when the script failed with EADDRINUSE: frees the port and restarts the script. */
export function AddrInUseBanner({ projectId, script, port }: Props) {
  const { data } = usePorts();
  const killer = usePortKiller();
  const action = useScriptAction(projectId);
  const [busy, setBusy] = useState(false);
  const holder = data?.rows.find((r) => r.port === port) ?? null;

  const run = async () => {
    setBusy(true);
    let free = holder === null;
    try {
      if (holder && (await killer.kill({ pid: holder.pid, port }))) {
        free = await api.ports.waitFree(port, FREE_TIMEOUT_MS);
        if (!free) toast.error(`Port ${port} is still in use`);
      }
    } catch (error) {
      toast.error(errorMessage(error));
      free = false;
    } finally {
      setBusy(false);
    }
    // The script action reports its own errors.
    if (free) action.mutate({ action: 'restart', script });
  };

  const who = holder ? `${holder.owner ? holder.owner.script : (holder.processName ?? 'a process')} (PID ${holder.pid})` : null;
  return (
    <div role="alert" className="flex items-center gap-2 border-b border-warn/30 bg-warn/10 px-3 py-1.5 text-xs text-warn">
      <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
      <span>{data ? (who ? `Port ${port} is in use by ${who}.` : `Port ${port} was in use. It is free now.`) : `Port ${port} is in use.`}</span>
      <Button variant="secondary" size="sm" className="ml-auto h-6" disabled={busy || !data} onClick={() => void run()}>
        {holder || !data ? 'Kill and restart' : 'Restart'}
      </Button>
      {killer.dialog}
    </div>
  );
}
