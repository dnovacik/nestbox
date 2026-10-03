import { ChevronDown, ChevronRight, Plus, RefreshCw, X } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import type { Todo } from '@shared/tools/todos/contract';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { relativeTime } from '@/lib/relative-time';
import { cn } from '@/lib/utils';
import type { ToolPanelProps } from '../types';
import { TRUNCATED_TEXT, tagCounts, tagTone } from './labels';
import { useOpenTodo, useTodos, useTodoTags } from './use-todos';

/** Rows drawn at once; past this the panel asks for a filter instead of drawing thousands of buttons. */
export const MAX_ROWS = 1_000;
const TAG_RE = /^[A-Za-z][A-Za-z0-9_]{1,19}$/;

function TagSettings({ projectId }: ToolPanelProps) {
  const { tags, setTags } = useTodoTags(projectId);
  const [draft, setDraft] = useState('');
  const add = (event: FormEvent) => {
    event.preventDefault();
    const tag = draft.trim().toUpperCase();
    if (!TAG_RE.test(tag) || tags.includes(tag) || tags.length >= 20) return;
    setTags.mutate([...tags, tag]);
    setDraft('');
  };
  return (
    <section aria-label="Tags" className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="mr-1 text-fg-muted">Tags</span>
      {tags.map((tag) => (
        <span key={tag} className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[11px]', tagTone(tag))}>
          {tag}
          {tags.length > 1 && (
            <button type="button" aria-label={`Remove ${tag}`} className="text-fg-muted hover:text-fg" onClick={() => setTags.mutate(tags.filter((t) => t !== tag))}>
              <X className="size-3" aria-hidden />
            </button>
          )}
        </span>
      ))}
      <form onSubmit={add} className="flex items-center gap-1">
        <Input aria-label="New tag" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add tag" className="h-6 w-24 font-mono text-[11px]" />
        <Button type="submit" variant="ghost" size="sm" className="h-6 px-1.5" aria-label="Add tag" disabled={!TAG_RE.test(draft.trim())}>
          <Plus className="size-3.5" aria-hidden />
        </Button>
      </form>
    </section>
  );
}

function FileGroup({ path, todos, onOpen }: { path: string; todos: Todo[]; onOpen(todo: Todo): void }) {
  const [open, setOpen] = useState(true);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li>
      <button type="button" aria-expanded={open} className="flex w-full items-center gap-1.5 py-1 text-left text-xs" onClick={() => setOpen(!open)}>
        <Chevron className="size-3.5 text-fg-muted" aria-hidden />
        <span className="min-w-0 truncate font-mono text-fg">{path}</span>
        <span className="font-mono text-fg-faint">{todos.length}</span>
      </button>
      {open && (
        <ul aria-label={path} className="mb-1 ml-5 flex flex-col">
          {todos.map((t) => (
            <li key={`${t.line}:${t.tag}`}>
              <button
                type="button"
                className="flex w-full items-baseline gap-3 rounded px-2 py-1 text-left text-xs hover:bg-hover"
                title={`Open ${path}:${t.line}`}
                onClick={() => onOpen(t)}
              >
                <span className="w-10 shrink-0 text-right font-mono text-fg-faint">{t.line}</span>
                <span className={cn('shrink-0 rounded border px-1 font-mono text-[10px]', tagTone(t.tag))}>{t.tag}</span>
                <span className="min-w-0 flex-1 truncate text-fg">{t.text || <span className="text-fg-faint">(no text)</span>}</span>
                {t.owner && <span className="shrink-0 text-fg-muted">{t.owner}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Tagged comments in the package, grouped by file; a click opens the editor at the line. */
export default function TodosPanel({ projectId }: ToolPanelProps) {
  const { result, scanning, isError, refresh } = useTodos(projectId);
  const open = useOpenTodo(projectId);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (result?.todos ?? []).filter(
      (t) => !hidden.has(t.tag) && (needle === '' || t.path.toLowerCase().includes(needle) || t.text.toLowerCase().includes(needle)),
    );
  }, [result, hidden, search]);
  const groups = useMemo(() => {
    const byFile = new Map<string, Todo[]>();
    for (const t of visible.slice(0, MAX_ROWS)) byFile.set(t.path, [...(byFile.get(t.path) ?? []), t]);
    return [...byFile];
  }, [visible]);

  const toggle = (tag: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  return (
    <section aria-label="TODOs" className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-fg">TODOs</h2>
          {result && (
            <p className="text-xs text-fg-muted">
              {`${result.todos.length.toLocaleString('en-US')} in ${result.files.toLocaleString('en-US')} files read · ${result.source === 'git' ? 'from git' : 'folder walk'} · scanned ${relativeTime(result.scannedAt)}`}
              {result.truncated && <span className="text-warn">{` · ${TRUNCATED_TEXT[result.truncated]}`}</span>}
            </p>
          )}
        </div>
        <Button variant="secondary" size="sm" disabled={scanning} onClick={refresh}>
          <RefreshCw className={cn('size-3.5', scanning && 'animate-spin')} aria-hidden />
          {scanning ? 'Scanning…' : 'Refresh'}
        </Button>
      </div>

      <TagSettings projectId={projectId} />
      {isError && <p className="text-xs text-fg-muted">Couldn't read the TODOs.</p>}

      {result && result.todos.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {tagCounts(result.todos).map(([tag, n]) => (
            <button
              key={tag}
              type="button"
              aria-pressed={!hidden.has(tag)}
              className={cn('rounded border px-2 py-0.5 font-mono text-[11px]', hidden.has(tag) ? 'border-line text-fg-faint' : tagTone(tag))}
              onClick={() => toggle(tag)}
            >
              {tag} {n}
            </button>
          ))}
          <Input aria-label="Search TODOs" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by path or text" className="ml-auto h-7 w-64 text-xs" />
        </div>
      )}

      {result && result.todos.length === 0 && <p className="text-xs text-fg-muted">No tagged comments found.</p>}
      {result && result.todos.length > 0 && visible.length === 0 && <p className="text-xs text-fg-muted">Nothing matches the filter.</p>}
      {groups.length > 0 && (
        <ul aria-label="Files with TODOs" className="flex flex-col">
          {groups.map(([path, todos]) => (
            <FileGroup key={path} path={path} todos={todos} onOpen={(t) => open.mutate({ path: t.path, line: t.line })} />
          ))}
        </ul>
      )}
      {visible.length > MAX_ROWS && (
        <p className="text-xs text-fg-muted">{`Showing the first ${MAX_ROWS.toLocaleString('en-US')} of ${visible.length.toLocaleString('en-US')}. Filter to see the rest.`}</p>
      )}
    </section>
  );
}
