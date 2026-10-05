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
import { useAddFolders } from '@/lib/queries';
import { useUiStore } from '@/state/ui-store';

/** A picked folder of sub-folder projects (app/ + api/): add them under a new group, or straight to the root. */
export function AddFoldersDialog() {
  const pending = useUiStore((s) => s.pendingFolders);
  const setPending = useUiStore((s) => s.setPendingFolders);
  const addFolders = useAddFolders();
  const [group, setGroup] = useState('');
  useEffect(() => {
    if (pending) setGroup(pending.name);
  }, [pending]);
  if (!pending) return null;
  const name = group.trim();
  const add = (asGroup: boolean) =>
    addFolders.mutate({ path: pending.path, group: asGroup ? name.slice(0, 100) : null });
  return (
    <Dialog open onOpenChange={(open) => !open && !addFolders.isPending && setPending(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add under a group?</DialogTitle>
          <DialogDescription>
            {pending.name} holds {pending.folders.length} projects. Each one is added on its own; a
            group keeps them together in the sidebar.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-fg-muted">
          {pending.folders.map((f) => (
            <li key={f.relPath} className="truncate">
              <span className="text-fg">{f.name}</span>{' '}
              <span className="font-mono">{f.relPath}</span>
            </li>
          ))}
        </ul>
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
        <DialogFooter>
          <Button variant="ghost" disabled={addFolders.isPending} onClick={() => setPending(null)}>
            Cancel
          </Button>
          <Button variant="secondary" disabled={addFolders.isPending} onClick={() => add(false)}>
            No, add without a group
          </Button>
          <Button disabled={addFolders.isPending || !name} onClick={() => add(true)}>
            Add under group
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
