import { useEffect, useState } from 'react';
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
import { useAddFolderAsOne, useAddFolders } from '@/lib/queries';
import { useUiStore } from '@/state/ui-store';

/**
 * A picked folder of sub-folder projects (app/ + api/): add them under a new group, straight to the root, or
 * keep the folder as one project whose sub-folders are packages (one run group starts them together).
 */
export function AddFoldersDialog() {
  const pending = useUiStore((s) => s.pendingFolders);
  const setPending = useUiStore((s) => s.setPendingFolders);
  const addFolders = useAddFolders();
  const addAsOne = useAddFolderAsOne();
  const busy = addFolders.isPending || addAsOne.isPending;
  const [group, setGroup] = useState('');
  useEffect(() => {
    if (pending) setGroup(pending.name);
  }, [pending]);
  if (!pending) return null;
  const name = group.trim();
  const add = (asGroup: boolean) =>
    addFolders.mutate({ path: pending.path, group: asGroup ? name.slice(0, 100) : null });
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && setPending(null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add under a group?</DialogTitle>
          <DialogDescription>
            {pending.name} holds {pending.folders.length} projects. Each one is added on its own; a
            group keeps them together in the sidebar.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-40 min-w-0 space-y-0.5 overflow-y-auto text-xs text-fg-muted">
          {pending.folders.map((f) => (
            <li key={f.relPath} className="min-w-0 truncate">
              <span className="text-fg">{f.name}</span>{' '}
              <span className="font-mono">{f.relPath}</span>
            </li>
          ))}
        </ul>
        <div className="flex min-w-0 flex-col gap-2 rounded-md border border-line px-3 py-2 sm:flex-row sm:items-center sm:gap-3">
          <p className="min-w-0 flex-1 text-xs text-fg-muted">
            Or keep them together as one project, so one run group can start them all (a frontend
            and its backend).
          </p>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => addAsOne.mutate(pending.path)}
            className="shrink-0"
          >
            Add as one project
          </Button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name) add(true);
          }}
        >
          <label className="flex flex-col gap-1.5 text-xs text-fg-muted">
            Group name
            <Input
              value={group}
              maxLength={100}
              autoFocus
              onChange={(e) => setGroup(e.target.value)}
              className="text-sm"
            />
          </label>
        </form>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="ghost" disabled={busy} onClick={() => setPending(null)}>
            Cancel
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => add(false)}>
            No, add without a group
          </Button>
          <Button disabled={busy || !name} onClick={() => add(true)}>
            Add under group
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
