import { useQueryClient } from '@tanstack/react-query';
import { FilePlus, Pencil } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { NestboxError } from '@shared/errors';
import type { ClaudeDoc } from '@shared/tools/claude/contract';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { queryKeys } from '@/lib/queries';
import { Markdown } from './Markdown';
import { docKey, useClaudeDoc } from './use-claude';

const HINTS: Record<ClaudeDoc, string> = {
  'CLAUDE.md': 'Shared project instructions, committed with the code.',
  'CLAUDE.local.md': 'Your personal notes for this project; keep it out of git.',
};

/** One of the two Markdown files: rendered preview, an editor, and Create when it is missing. */
export function DocCard({ projectId, file }: { projectId: string; file: ClaudeDoc }) {
  const queryClient = useQueryClient();
  const { data } = useClaudeDoc(projectId, file);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);

  const save = async () => {
    if (draft === null || !data) return;
    setSaving(true);
    try {
      const { version } = await api.tools.invoke('claude', projectId, 'writeDoc', { file, text: draft, version: data.version });
      queryClient.setQueryData(docKey(projectId, file), { text: draft, version });
      setDraft(null);
      setConflict(false);
      toast.success(`Saved ${file}`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.tool('claude', projectId, 'status') });
    } catch (error) {
      if (error instanceof NestboxError && error.code === 'CONFLICT') {
        // Reload so the next Save is based on what is on disk now; the draft stays in the editor.
        setConflict(true);
        void queryClient.invalidateQueries({ queryKey: docKey(projectId, file) });
      } else {
        toast.error(errorMessage(error));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label={file} className="flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-card p-4">
      <div className="flex items-center gap-2">
        <h3 className="font-mono text-xs font-semibold text-fg">{file}</h3>
        <span className="truncate text-[11px] text-fg-faint">{HINTS[file]}</span>
        {data && data.version !== null && draft === null && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setDraft(data.text)}>
            <Pencil />
            Edit
          </Button>
        )}
      </div>
      {!data ? (
        <p className="text-xs text-fg-muted">Loading…</p>
      ) : draft !== null ? (
        <>
          <textarea
            aria-label={`Edit ${file}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="min-h-64 w-full resize-y rounded-md border border-line bg-surface p-3 font-mono text-xs text-fg outline-none focus-visible:border-brand"
          />
          {conflict && (
            <p role="alert" className="text-[11px] text-warn">
              {file} changed on disk and was reloaded. Saving now replaces it with your text.
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void save()} disabled={saving}>
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(null);
                setConflict(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : data.version === null ? (
        <div className="flex items-center gap-3">
          <p className="text-xs text-fg-muted">{file} does not exist yet.</p>
          <Button size="sm" variant="secondary" onClick={() => setDraft('')}>
            <FilePlus />
            Create {file}
          </Button>
        </div>
      ) : data.text.trim() === '' ? (
        <p className="text-xs text-fg-faint">Empty.</p>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          <Markdown text={data.text} />
        </div>
      )}
    </section>
  );
}
