import { Pencil, Play, Plus, Square, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { isLive } from '@shared/processes';
import type { PackageScripts } from '@shared/tools/scripts/contract';
import type { RunGroup, RunGroupEntry } from '@shared/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useProcesses } from '@/lib/queries';
import { workspaceId } from '@shared/detected';
import { useRunGroupActions, useScriptList } from './use-scripts';

const sameEntry = (a: RunGroupEntry, b: RunGroupEntry): boolean => a.relPath === b.relPath && a.script === b.script;

interface EditorProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  packages: PackageScripts[];
  initial: RunGroup | null;
  onSave(input: { previousName?: string; group: RunGroup }): void;
}

function RunGroupEditor({ open, onOpenChange, packages, initial, onSave }: EditorProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [entries, setEntries] = useState<RunGroupEntry[]>(initial?.entries ?? []);
  const toggle = (entry: RunGroupEntry) =>
    setEntries((prev) => (prev.some((e) => sameEntry(e, entry)) ? prev.filter((e) => !sameEntry(e, entry)) : [...prev, entry]));
  const canSave = name.trim() !== '' && entries.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit run group' : 'New run group'}</DialogTitle>
          <DialogDescription>Scripts in a run group start and stop together.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSave) return;
            onSave({ ...(initial ? { previousName: initial.name } : {}), group: { name: name.trim(), entries, compose: initial?.compose ?? [] } });
          }}
        >
          <label className="block space-y-1 text-xs text-fg-muted">
            <span>Name</span>
            <Input aria-label="Group name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className="h-8 text-sm" />
          </label>
          {packages.map((pkg) => (
            <fieldset key={pkg.relPath} className="space-y-1">
              <legend className="mb-1 text-[10px] font-semibold tracking-wider text-fg-muted uppercase">
                {pkg.relPath === '' ? 'Root' : pkg.relPath}
              </legend>
              {pkg.scripts.length === 0 && <p className="text-xs text-fg-faint">No scripts.</p>}
              {pkg.scripts.map((script) => {
                const entry = { relPath: pkg.relPath, script };
                return (
                  <label key={script} className="flex items-center gap-2 font-mono text-xs text-fg">
                    <input
                      type="checkbox"
                      className="accent-brand"
                      checked={entries.some((e) => sameEntry(e, entry))}
                      onChange={() => toggle(entry)}
                    />
                    {script}
                  </label>
                );
              })}
            </fieldset>
          ))}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Run groups of a root project. Hidden on workspace packages (their list returns runGroups: null). */
export function RunGroups({ projectId }: { projectId: string }) {
  const { data } = useScriptList(projectId);
  const { data: processes = [] } = useProcesses();
  const actions = useRunGroupActions(projectId);
  const [editing, setEditing] = useState<RunGroup | 'new' | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  if (!data?.runGroups || !data.packages) return null;
  const packages = data.packages;

  const processIdOf = (entry: RunGroupEntry) => (entry.relPath === '' ? projectId : workspaceId(projectId, entry.relPath));
  const liveIn = (group: RunGroup) =>
    group.entries.some((e) => processes.some((p) => p.projectId === processIdOf(e) && p.script === e.script && isLive(p.state)));

  return (
    <section aria-label="Run groups" className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">Run groups</h3>
        <Button variant="ghost" size="sm" onClick={() => setEditing('new')}>
          <Plus className="text-brand" />
          New group
        </Button>
      </div>
      {data.runGroups.length === 0 ? (
        <p className="text-xs text-fg-faint">Start several scripts together, e.g. API + web.</p>
      ) : (
        <ul className="space-y-1.5">
          {data.runGroups.map((group) => (
            <li key={group.name} className="flex items-center gap-2 rounded-md border border-line bg-card px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-fg">{group.name}</p>
                <p className="truncate font-mono text-[11px] text-fg-muted">
                  {group.entries.map((e) => (e.relPath === '' ? e.script : `${e.relPath} ${e.script}`)).join(', ')}
                </p>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-1">
                {liveIn(group) ? (
                  <Button variant="ghost" size="icon" aria-label={`Stop group ${group.name}`} onClick={() => actions.stop.mutate(group.name)}>
                    <Square className="text-err" />
                  </Button>
                ) : (
                  <Button variant="ghost" size="icon" aria-label={`Start group ${group.name}`} onClick={() => actions.start.mutate(group.name)}>
                    <Play className="text-ok" />
                  </Button>
                )}
                <Button variant="ghost" size="icon" aria-label={`Edit group ${group.name}`} onClick={() => setEditing(group)}>
                  <Pencil />
                </Button>
                <Button variant="ghost" size="icon" aria-label={`Delete group ${group.name}`} onClick={() => setDeleting(group.name)}>
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing !== null && (
        <RunGroupEditor
          key={editing === 'new' ? 'new' : editing.name}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          packages={packages}
          initial={editing === 'new' ? null : editing}
          onSave={(input) => actions.save.mutate(input, { onSuccess: () => setEditing(null) })}
        />
      )}
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete run group “{deleting}”?</AlertDialogTitle>
            <AlertDialogDescription>Its scripts are not stopped or changed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-err text-fg hover:bg-err/90"
              onClick={() => deleting !== null && actions.remove.mutate(deleting)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
