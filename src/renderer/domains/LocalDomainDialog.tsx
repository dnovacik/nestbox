import { useState } from 'react';
import { LABEL } from '@shared/domains';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useDomainsActions, useDomainsStatus } from './use-domains';

export function LocalDomainDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Local domain</DialogTitle>
        </DialogHeader>
        {/* Mounted only while open, so edits from a closed dialog never come back. */}
        {open && <LocalDomainForm projectId={projectId} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function LocalDomainForm({ projectId, onDone }: { projectId: string; onDone(): void }) {
  const { data } = useDomainsStatus();
  const actions = useDomainsActions();
  const route = data?.routes.find((r) => r.projectId === projectId);
  const current = route?.name.split('.')[0] ?? '';
  const [label, setLabel] = useState<string | null>(null);
  const [rewrite, setRewrite] = useState<boolean | null>(null);
  const rewriteNow = rewrite ?? route?.rewriteHost ?? false;
  const value = label ?? current;
  const ok = LABEL.test(value);
  const clash = data?.clashes.includes(projectId) ?? false;
  const saving = actions.setName.isPending || actions.setRewriteHost.isPending;

  async function save() {
    try {
      if (rewrite !== null && rewrite !== route?.rewriteHost)
        await actions.setRewriteHost.mutateAsync({ projectId, rewrite });
      if (label !== null && label !== current)
        await actions.setName.mutateAsync({ projectId, label });
      onDone();
    } catch {
      // The mutation's onError has shown a toast; the dialog stays open with the edit.
    }
  }

  return (
    <>
      <label className="block text-xs text-fg-muted">
        Name
        <Input
          aria-label="Name"
          className="mt-1 h-8 text-sm"
          value={value}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      {!ok && (
        <p className="text-xs text-warn">
          Lowercase letters, digits and dashes; no dash at either end.
        </p>
      )}
      {clash && (
        <p className="text-xs text-warn">Another project has this name, so a number was added.</p>
      )}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-fg">Rewrite the Host header</p>
          <p className="text-xs text-fg-muted">
            Only if the app refuses unknown host names: it then sees localhost:&lt;port&gt;.
          </p>
        </div>
        <Switch
          aria-label="Rewrite the Host header"
          checked={rewriteNow}
          onCheckedChange={setRewrite}
        />
      </div>
      <DialogFooter>
        <Button disabled={!ok || saving} onClick={() => void save()}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
