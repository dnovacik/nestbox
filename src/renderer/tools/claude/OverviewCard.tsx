import { Button } from '@/components/ui/button';
import { useUiStore } from '@/state/ui-store';
import type { ToolPanelProps } from '../types';
import { useClaudeStatus } from './use-claude';

export function ClaudeCard({ projectId }: ToolPanelProps) {
  const { data } = useClaudeStatus(projectId);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const files = data?.files;
  const summary = files
    ? [files.claudeMd ? 'CLAUDE.md' : 'no CLAUDE.md', `${files.commands.length} commands`, `${files.mcpServers.length} MCP servers`].join(' · ')
    : null;
  return (
    <section aria-label="Claude Code" className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4">
      <h3 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">Claude Code</h3>
      {data && (
        <>
          <p className={data.cli.found === false ? 'text-xs text-warn' : 'text-xs text-fg-muted'}>
            {data.cli.found === false ? 'claude not installed' : data.cli.version ? `claude ${data.cli.version}` : 'claude'}
          </p>
          {summary && <p className="text-xs text-fg-faint">{summary}</p>}
        </>
      )}
      <Button variant="secondary" size="sm" className="self-start" onClick={() => setActiveTab(projectId, 'claude')}>
        Open Claude Code
      </Button>
    </section>
  );
}
