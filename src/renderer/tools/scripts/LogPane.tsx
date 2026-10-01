import { useCallback, useMemo } from 'react';
import { isLive, type LogLine } from '@shared/processes';
import { LogView } from '@/components/log/LogView';
import type { LinkMatch } from '@/components/log/links';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useProcesses } from '@/lib/queries';
import { addrInUsePort } from './addr-in-use';
import { AddrInUseBanner } from './AddrInUseBanner';
import { scriptLogSource } from './script-log-source';
import { useExportLogs, useOpenFileAt } from './use-scripts';

export interface LogPaneProps {
  projectId: string;
  script: string | null;
  scripts: string[];
  onScriptChange(script: string): void;
  /** The pane that clicks in the script list fill. */
  active: boolean;
  onActivate(): void;
}

/** A script's output: the generic log view plus the script picker, export and the EADDRINUSE banner. */
export function LogPane({ projectId, script, scripts, onScriptChange, active, onActivate }: LogPaneProps) {
  const source = useMemo(() => (script === null ? null : scriptLogSource(projectId, script)), [projectId, script]);
  const exportLogs = useExportLogs(projectId);
  const openFileAt = useOpenFileAt(projectId);
  const { data: processes = [] } = useProcesses();
  const live = processes.some((p) => p.projectId === projectId && p.script === script && isLive(p.state));

  const onOpenLink = useCallback((link: LinkMatch) => openFileAt.mutate({ path: link.path, line: link.line }), [openFileAt]);

  return (
    <LogView
      source={source}
      name={script}
      emptyHint="Pick a script to see its output."
      active={active}
      onActivate={onActivate}
      onOpenLink={onOpenLink}
      onExport={(seqs) => script !== null && exportLogs.mutate({ script, seqs })}
      leading={
        <Select value={script ?? undefined} onValueChange={onScriptChange}>
          <SelectTrigger size="sm" aria-label="Script" className="h-7 max-w-48 font-mono text-xs">
            <SelectValue placeholder="Pick a script…" />
          </SelectTrigger>
          <SelectContent>
            {scripts.map((s) => (
              <SelectItem key={s} value={s} className="font-mono text-xs">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
      renderBanner={(lines) => <PortBanner projectId={projectId} script={script} live={live} lines={lines} />}
    />
  );
}

function PortBanner({ projectId, script, live, lines }: { projectId: string; script: string | null; live: boolean; lines: readonly LogLine[] }) {
  // Only while the script is down: a running script's every log batch would otherwise rescan the buffer.
  const port = useMemo(() => (live ? null : addrInUsePort(lines)), [live, lines]);
  return script !== null && port !== null ? <AddrInUseBanner projectId={projectId} script={script} port={port} /> : null;
}
