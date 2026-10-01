import { History, SquareTerminal, TriangleAlert } from 'lucide-react';
import type { ClaudeStatus } from '@shared/tools/claude/contract';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { ToolPanelProps } from '../types';
import { ContextDiff } from './ContextDiff';
import { DocCard } from './DocCard';
import { PromptBox } from './PromptBox';
import { useClaudeActions, useClaudeStatus } from './use-claude';

const INSTALL_DOCS = 'https://docs.claude.com/en/docs/claude-code/setup';

function CliStatus({ cli }: { cli: ClaudeStatus['cli'] }) {
  if (cli.found === true) {
    return <span className="text-xs text-ok">{cli.version ? `claude ${cli.version}` : 'claude found'}</span>;
  }
  if (cli.found === null) return <span className="text-xs text-fg-faint">Can't check for the claude command on this platform.</span>;
  return (
    <span className="text-xs text-warn">
      The claude command was not found. Install it with <code className="font-mono">npm install -g @anthropic-ai/claude-code</code> (
      <a
        href={INSTALL_DOCS}
        className="text-brand hover:underline"
        onClick={(e) => {
          e.preventDefault();
          void api.app.openExternal(INSTALL_DOCS);
        }}
      >
        setup guide
      </a>
      ), then reopen this tab.
    </span>
  );
}

function List({ title, items }: { title: string; items: { key: string; label: string; detail?: string | null }[] }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <h4 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">
        {title} <span className="text-fg-faint">{items.length}</span>
      </h4>
      {items.length === 0 ? (
        <p className="text-xs text-fg-faint">None</p>
      ) : (
        <ul aria-label={title} className="space-y-1">
          {items.map((item) => (
            <li key={item.key} className="min-w-0 text-xs">
              <span className="font-mono text-fg">{item.label}</span>
              {item.detail && <span className="ml-2 text-fg-faint">{item.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ClaudeFolder({ files }: { files: ClaudeStatus['files'] }) {
  const counts = (s: ClaudeStatus['files']['settings'][number]) =>
    [`${s.allow.length} allowed`, `${s.deny.length} denied`, `${s.ask.length} ask`, s.hooks.length > 0 ? `hooks: ${s.hooks.join(', ')}` : null]
      .filter(Boolean)
      .join(' · ');
  return (
    <section aria-label=".claude folder" className="space-y-4 rounded-lg border border-line bg-card p-4">
      <h3 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">.claude</h3>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <List title="Commands" items={files.commands.map((c) => ({ key: c.name, label: `/${c.name}`, detail: c.description }))} />
        <List title="Agents" items={files.agents.map((a) => ({ key: a.name, label: a.name, detail: a.description }))} />
        <List title="Skills" items={files.skills.map((s) => ({ key: s.name, label: s.name, detail: s.description }))} />
        <List title="Settings" items={files.settings.map((s) => ({ key: s.file, label: s.file, detail: counts(s) }))} />
        <List
          title="MCP servers"
          items={files.mcpServers.map((m) => ({
            key: m.name,
            label: m.name,
            detail: [m.command ?? m.url ?? m.type, m.argCount > 0 ? `${m.argCount} args` : null].filter(Boolean).join(' · '),
          }))}
        />
      </div>
      {files.unreadable.length > 0 && (
        <p className="flex items-center gap-1.5 text-[11px] text-warn">
          <TriangleAlert className="size-3.5" aria-hidden />
          Couldn't read {files.unreadable.join(', ')}.
        </p>
      )}
    </section>
  );
}

/** Claude Code readiness for a package: CLI, CLAUDE.md files, .claude contents, a quick prompt and the context block. */
export default function ClaudePanel({ projectId }: ToolPanelProps) {
  const { data: status } = useClaudeStatus(projectId);
  const actions = useClaudeActions(projectId);
  if (!status) return <p className="p-6 text-sm text-fg-muted">Loading…</p>;
  const missing = status.cli.found === false;

  return (
    <section aria-label="Claude Code" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-card p-4">
        <CliStatus cli={status.cli} />
        <span className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => actions.open.mutate()} disabled={missing}>
            <SquareTerminal />
            Open Claude
          </Button>
          <Button size="sm" variant="secondary" onClick={() => actions.continue.mutate()} disabled={missing}>
            <History />
            Continue
          </Button>
        </span>
      </div>

      {status.gitignore.map((g) =>
        g.ignored === false ? (
          <p key={g.file} role="alert" className="flex items-center gap-1.5 text-xs text-warn">
            <TriangleAlert className="size-3.5" aria-hidden />
            <span className="font-mono">{g.file}</span> is personal but not in .gitignore, so it could be committed.
          </p>
        ) : g.ignored === null ? (
          <p key={g.file} className="text-[11px] text-fg-faint">
            Couldn't check whether <span className="font-mono">{g.file}</span> is gitignored (no git, or not a repository).
          </p>
        ) : null,
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <DocCard projectId={projectId} file="CLAUDE.md" />
        <DocCard projectId={projectId} file="CLAUDE.local.md" />
      </div>
      <ClaudeFolder files={status.files} />
      <ContextDiff projectId={projectId} />
      <PromptBox projectId={projectId} running={status.promptRunning} disabled={missing} />
    </section>
  );
}
