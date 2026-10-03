import { Play, Square } from 'lucide-react';
import { useMemo, useState } from 'react';
import { LogView } from '@/components/log/LogView';
import { Button } from '@/components/ui/button';
import { useModKey } from '@/lib/platform';
import { claudeLogSource, useClaudeActions } from './use-claude';

/** A one-shot `claude -p`: the text goes to its stdin, the output streams into the log below. */
export function PromptBox({ projectId, running, disabled }: { projectId: string; running: boolean; disabled: boolean }) {
  const actions = useClaudeActions(projectId);
  const modKey = useModKey();
  const source = useMemo(() => claudeLogSource(projectId), [projectId]);
  const [text, setText] = useState('');
  const canRun = !disabled && !running && text.trim() !== '' && !actions.prompt.isPending;
  const run = () => {
    if (canRun) actions.prompt.mutate(text);
  };

  return (
    <section aria-label="Quick prompt" className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">Quick prompt</h3>
        <span className="text-[11px] text-fg-faint">Runs claude -p in this folder with Claude Code's own permission settings.</span>
      </div>
      <textarea
        aria-label="Prompt"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            run();
          }
        }}
        placeholder={`Ask Claude about this project… (${modKey}+Enter to run)`}
        className="min-h-20 w-full resize-y rounded-md border border-line bg-surface p-3 text-sm text-fg outline-none placeholder:text-fg-faint focus-visible:border-brand"
      />
      <div className="flex gap-2">
        {running ? (
          <Button size="sm" variant="secondary" onClick={() => actions.stopPrompt.mutate()}>
            <Square className="text-err" />
            Stop
          </Button>
        ) : (
          <Button size="sm" onClick={run} disabled={!canRun}>
            <Play />
            Run
          </Button>
        )}
      </div>
      <div className="flex h-72 flex-col">
        <LogView source={source} name="Claude" emptyHint="Output of the prompt shows here." />
      </div>
    </section>
  );
}
