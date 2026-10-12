import { Lock, Plus, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { CONFIG_KEY, type ConfigMatrix, type EditableConfigType } from '@shared/tools/env/contract';
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
import { AddVariableDialog } from './AddVariableDialog';
import { EditAsText, type TextFile } from './EditAsText';
import { EditValueDialog, type EditTarget } from './EditValueDialog';
import { RawEditDialog } from './RawEditDialog';
import { revealConfigValue, useConfigCopy, useConfigEdit, useCreateConfigFile } from './use-env';
import { ValueCell } from './ValueCell';

const BASE = 'appsettings.json';
const KEY_HINT =
  'Sections joined by ":" (Logging:LogLevel:Default); letters, digits, "_", ".", "$" or "-".';

/** Each launch profile and the environment it runs as, with a way to create a missing file. */
function Profiles({
  matrix,
  onCreate,
  creating,
}: {
  matrix: ConfigMatrix;
  onCreate(environment: string): void;
  creating: boolean;
}) {
  if (matrix.profiles.length === 0) return null;
  return (
    <ul aria-label="Launch profiles" className="flex flex-wrap items-center gap-2 text-xs">
      {matrix.profiles.map((p) => (
        <li
          key={p.name}
          className="flex items-center gap-1 rounded-md border border-line px-2 py-0.5"
        >
          <span className="font-mono text-fg">
            {p.name} → {p.environment}
          </span>
          {!p.exists && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[11px]"
              disabled={creating}
              onClick={() => onCreate(p.environment)}
            >
              Create {p.file}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** appsettings*.json side by side, values masked: .NET's configuration keys. */
export function ConfigSection({ projectId, matrix }: { projectId: string; matrix: ConfigMatrix }) {
  const edit = useConfigEdit(projectId);
  const copy = useConfigCopy(projectId);
  const createFile = useCreateConfigFile(projectId);
  const [adding, setAdding] = useState(false);
  const [rawFile, setRawFile] = useState<TextFile | null>(null);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [removing, setRemoving] = useState<{ file: string; key: string } | null>(null);

  const versionOf = (file: string) => matrix.files.find((f) => f.name === file)?.version ?? null;
  // Keys come only from files that could be read: the others take raw edits only.
  const editable = matrix.files.filter((f) => !f.invalid && !f.tooLarge);
  const has = (file: string, key: string) => {
    const row = matrix.keys.find((k) => k.key.toLowerCase() === key.toLowerCase());
    return (row?.cells[file] ?? 'absent') !== 'absent';
  };
  const problems = matrix.files.filter((f) => f.invalid || f.tooLarge);
  const duplicates = matrix.files.filter((f) => f.caseDuplicates.length > 0);

  const save = (value: string, type: EditableConfigType) => {
    if (!editing) return;
    const version = versionOf(editing.file);
    if (editing.mode === 'edit' && version !== null) {
      edit.mutate({
        method: 'configSetValue',
        file: editing.file,
        key: editing.key,
        value,
        type,
        version,
      });
    } else {
      edit.mutate({
        method: 'configAddKey',
        file: editing.file,
        key: editing.key,
        value,
        type,
        version,
      });
    }
    setEditing(null);
  };

  return (
    <section aria-label="Configuration" className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <h2 className="text-sm font-semibold text-fg">Configuration</h2>
        <Profiles
          matrix={matrix}
          creating={createFile.isPending}
          onCreate={(environment) => createFile.mutate(environment)}
        />
        <div className="ml-auto flex items-center gap-1">
          <EditAsText
            files={matrix.files.filter((f) => !f.tooLarge)}
            title="Edit a whole settings file as JSON"
            onPick={setRawFile}
          />
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <Plus />
            Add key
          </Button>
        </div>
      </div>
      {problems.map((f) => (
        <p key={f.name} role="alert" className="flex items-center gap-1.5 text-xs text-warn">
          <TriangleAlert aria-hidden className="size-3.5" />
          {f.invalid
            ? `${f.name} isn't valid JSON: edit it as text to fix it.`
            : `${f.name} is too large to show (over 1 MiB or 2,000 keys).`}
        </p>
      ))}
      {duplicates.map((f) => (
        <p key={f.name} className="flex items-center gap-1.5 text-xs text-warn">
          <TriangleAlert aria-hidden className="size-3.5" />
          {f.name} has keys that differ only in case ({f.caseDuplicates.join(', ')}); .NET uses the
          last one.
        </p>
      ))}
      {matrix.truncated && (
        <p className="text-xs text-fg-muted">Only the first 20 settings files are shown.</p>
      )}
      {matrix.files.length === 0 ? (
        <p className="text-xs text-fg-muted">No appsettings files in this folder.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-card">
          <table aria-label="Settings files" className="w-full text-left text-xs">
            <thead className="border-b border-line text-[10px] tracking-wider text-fg-muted uppercase">
              <tr>
                <th className="px-3 py-2 font-semibold">Key</th>
                {matrix.files.map((f) => (
                  <th key={f.name} className="px-3 py-2 font-mono font-semibold normal-case">
                    <span className="inline-flex items-center gap-1">
                      {f.name}
                      {f.readOnly && <Lock aria-hidden className="size-3" />}
                      {(f.invalid || f.tooLarge || f.caseDuplicates.length > 0) && (
                        <TriangleAlert aria-hidden className="size-3 text-warn" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.keys.map((k) => (
                <tr key={k.key} className="border-t border-line align-middle">
                  <th scope="row" className="px-3 py-1.5 font-mono font-medium text-fg">
                    <span className="mr-2">{k.key}</span>
                    {k.overridden && (
                      <span
                        title={`Set in ${BASE} and in an environment file`}
                        className="mr-1 rounded border border-line px-1 py-0.5 text-[10px] text-fg-muted"
                      >
                        overridden
                      </span>
                    )}
                    {k.envOnly && (
                      <span
                        title={`Not in ${BASE}`}
                        className="rounded bg-warn/15 px-1 py-0.5 text-[10px] text-warn"
                      >
                        env only
                      </span>
                    )}
                  </th>
                  {matrix.files.map((f) => (
                    <td key={f.name} className="max-w-64 px-3 py-1.5">
                      <ValueCell
                        reveal={() =>
                          revealConfigValue(projectId, f.name, k.key).then((r) => r.value)
                        }
                        file={f.name}
                        envKey={k.key}
                        state={k.cells[f.name] ?? 'absent'}
                        readOnly={f.readOnly || f.invalid || f.tooLarge}
                        onCopy={() => copy.mutate({ file: f.name, key: k.key })}
                        onEdit={() =>
                          setEditing({ mode: 'edit', file: f.name, key: k.key, copyFrom: null })
                        }
                        onAdd={() =>
                          setEditing({ mode: 'add', file: f.name, key: k.key, copyFrom: null })
                        }
                        onRemove={() => setRemoving({ file: f.name, key: k.key })}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <EditValueDialog
        target={editing}
        typed
        load={(file, key) => revealConfigValue(projectId, file, key)}
        onClose={() => setEditing(null)}
        onSave={save}
      />
      {rawFile && (
        <RawEditDialog
          projectId={projectId}
          file={rawFile.name}
          readOnly={rawFile.readOnly}
          kind="config"
          onClose={() => setRawFile(null)}
        />
      )}
      {adding && (
        <AddVariableDialog
          title="Add key"
          files={editable}
          has={has}
          suggestions={[]}
          newFile={BASE}
          keyPattern={CONFIG_KEY}
          keyHint={KEY_HINT}
          typed
          onClose={() => setAdding(false)}
          onSave={({ file, key, value, type }) => {
            edit.mutate({
              method: 'configAddKey',
              file,
              key,
              value,
              type,
              version: versionOf(file),
            });
            setAdding(false);
          }}
        />
      )}
      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Remove ${removing?.key ?? ''} from ${removing?.file ?? ''}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              Only this key is removed; comments and the rest of the file stay as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const version = removing && versionOf(removing.file);
                if (removing && version)
                  edit.mutate({
                    method: 'configRemoveKey',
                    file: removing.file,
                    key: removing.key,
                    version,
                  });
                setRemoving(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
