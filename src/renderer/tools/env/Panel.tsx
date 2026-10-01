import { Lock, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { EnvMatrix } from '@shared/tools/env/contract';
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
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { ToolPanelProps } from '../types';
import { EditValueDialog, type EditTarget } from './EditValueDialog';
import { useEnvCopy, useEnvEdit, useEnvMatrix } from './use-env';
import { ValueCell } from './ValueCell';

type Confirm = { kind: 'remove'; file: string; key: string } | { kind: 'switch'; file: string; name: string };

function Profiles({ matrix, onSwitch }: { matrix: EnvMatrix; onSwitch(file: string, name: string): void }) {
  if (matrix.profiles.length === 0) return null;
  // A symlinked .env is read-only: switching would have to replace it.
  const canSwitch = !matrix.files.find((f) => f.name === '.env')?.readOnly;
  return (
    <div role="group" aria-label="Profiles" className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">Profiles</span>
      {matrix.profiles.map((p) => (
        <span key={p.file} className={cn('flex items-center gap-1 rounded-md border px-2 py-0.5', p.active ? 'border-brand/50 bg-brand/10' : 'border-line')}>
          <span className="font-mono text-fg">{p.name}</span>
          {p.active ? (
            <span className="text-[10px] text-brand">active</span>
          ) : !canSwitch ? null : (
            <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[11px]" onClick={() => onSwitch(p.file, p.name)}>
              Switch to {p.name}
            </Button>
          )}
        </span>
      ))}
    </div>
  );
}

/** Every .env* file of the package side by side, values masked. */
export default function EnvPanel({ projectId }: ToolPanelProps) {
  const { data: matrix, isError } = useEnvMatrix(projectId);
  const edit = useEnvEdit(projectId);
  const copy = useEnvCopy(projectId);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  if (isError) return <p className="text-sm text-err">Couldn't read the env files.</p>;
  if (!matrix) return <p className="text-sm text-fg-muted">Loading…</p>;

  const versionOf = (file: string) => matrix.files.find((f) => f.name === file)?.version ?? null;
  const keys = flaggedOnly ? matrix.keys.filter((k) => k.missing || k.undocumented) : matrix.keys;
  const hasEnv = matrix.files.some((f) => f.name === '.env');
  const noActiveProfile = hasEnv && !matrix.profiles.some((p) => p.active);

  const save = (value: string) => {
    if (!editing) return;
    const version = versionOf(editing.file);
    if (editing.mode === 'edit' && version !== null) {
      edit.mutate({ method: 'setValue', file: editing.file, key: editing.key, value, version });
    } else {
      edit.mutate({ method: 'addKey', file: editing.file, key: editing.key, value, version });
    }
    setEditing(null);
  };

  const confirmed = () => {
    if (!confirm) return;
    if (confirm.kind === 'remove') {
      const version = versionOf(confirm.file);
      if (version !== null) edit.mutate({ method: 'removeKey', file: confirm.file, key: confirm.key, version });
    } else {
      edit.mutate({ method: 'switchProfile', file: confirm.file, envVersion: versionOf('.env') });
    }
    setConfirm(null);
  };

  return (
    <section aria-label="Env" className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <h2 className="text-sm font-semibold text-fg">Env files</h2>
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          <Switch aria-label="Flagged only" checked={flaggedOnly} onCheckedChange={setFlaggedOnly} />
          Flagged only
        </label>
        <Profiles matrix={matrix} onSwitch={(file, name) => setConfirm({ kind: 'switch', file, name })} />
      </div>
      {matrix.files.length === 0 ? (
        <p className="text-xs text-fg-muted">No .env files in this folder.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-card">
          <table aria-label="Env files" className="w-full text-left text-xs">
            <thead className="border-b border-line text-[10px] tracking-wider text-fg-muted uppercase">
              <tr>
                <th className="px-3 py-2 font-semibold">Key</th>
                {matrix.files.map((f) => (
                  <th key={f.name} className="px-3 py-2 font-mono font-semibold normal-case">
                    <span className="inline-flex items-center gap-1">
                      {f.name}
                      {f.readOnly && <Lock aria-hidden className="size-3" />}
                      {f.duplicates.length > 0 && <TriangleAlert aria-hidden className="size-3 text-warn" />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.key} className="border-t border-line align-middle">
                  <th scope="row" className="px-3 py-1.5 font-mono font-medium text-fg">
                    <span className="mr-2">{k.key}</span>
                    {k.missing && <span className="rounded bg-err/15 px-1 py-0.5 text-[10px] text-err">missing in .env</span>}
                    {k.undocumented && <span className="rounded bg-warn/15 px-1 py-0.5 text-[10px] text-warn">not in example</span>}
                  </th>
                  {matrix.files.map((f) => (
                    <td key={f.name} className="max-w-64 px-3 py-1.5">
                      <ValueCell
                        projectId={projectId}
                        file={f.name}
                        envKey={k.key}
                        state={k.cells[f.name] ?? 'absent'}
                        readOnly={f.readOnly}
                        onCopy={() => copy.mutate({ file: f.name, key: k.key })}
                        onEdit={() => setEditing({ mode: 'edit', file: f.name, key: k.key, copyFrom: null })}
                        onAdd={() =>
                          setEditing({
                            mode: 'add',
                            file: f.name,
                            key: k.key,
                            copyFrom: matrix.example && matrix.example !== f.name && k.cells[matrix.example] === 'set' ? matrix.example : null,
                          })
                        }
                        onRemove={() => setConfirm({ kind: 'remove', file: f.name, key: k.key })}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <EditValueDialog projectId={projectId} target={editing} onClose={() => setEditing(null)} onSave={save} />
      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === 'remove' ? `Remove ${confirm.key} from ${confirm.file}?` : `Switch to ${confirm?.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === 'remove'
                ? 'Only this key is removed; the rest of the file stays as it is.'
                : `${confirm?.file} is copied over .env, and the current .env is saved as .env.backup.${
                    noActiveProfile ? ' Your current .env matches no profile. It will be kept only as .env.backup.' : ''
                  }`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmed}>{confirm?.kind === 'remove' ? 'Remove' : 'Switch'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
