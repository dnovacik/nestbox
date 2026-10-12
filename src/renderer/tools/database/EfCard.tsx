import { Copy, FilePlus, Loader2, Play, Square } from 'lucide-react';
import { useState } from 'react';
import {
  type DbStatus,
  EF_INSTALL_COMMAND,
  type EfInput,
  type EfMigration,
  MIGRATION_NAME,
} from '@shared/tools/database/contract';
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
import { cn } from '@/lib/utils';
import { TONE_DOT, TONE_TEXT } from './labels';
import { useDatabaseActions } from './use-database';

type Ef = NonNullable<DbStatus['ef']>;
type Request = Omit<EfInput, 'environment' | 'context'>;

const select = 'h-7 rounded-md border border-line bg-app px-2 font-mono text-xs text-fg';
const NAME_HINT = 'Letters, digits and _; not starting with a digit';

const APPLIED = {
  true: { text: 'Applied', tone: 'ok' },
  false: { text: 'Pending', tone: 'warn' },
  null: { text: 'Unknown', tone: 'muted' },
} as const;

/** "2026-10-12 15:11" from EF's id timestamp (UTC, as EF writes it). */
function migrationDate(id: string): string {
  const t = id.slice(0, 14);
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)} ${t.slice(8, 10)}:${t.slice(10, 12)}`;
}

/** What a confirmation asks; the request runs with confirmed: true. */
interface Confirm {
  title: string;
  description?: string;
  action: string;
  request: Request;
}

function AddMigrationDialog({ onClose, onAdd }: { onClose(): void; onAdd(name: string): void }) {
  const [name, setName] = useState('');
  const valid = MIGRATION_NAME.test(name);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add migration</DialogTitle>
          <DialogDescription>
            EF compares the model with the last migration and writes the difference.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onAdd(name);
          }}
        >
          <label className="block space-y-1 text-xs text-fg-muted">
            Name
            <Input
              aria-label="Migration name"
              autoFocus
              value={name}
              aria-invalid={name !== '' && !valid}
              onChange={(e) => setName(e.target.value)}
              className="font-mono"
            />
          </label>
          {name !== '' && !valid && <p className="text-xs text-err">{NAME_HINT}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MigrationList({
  items,
  busy,
  onRollback,
  onRevertAll,
}: {
  items: EfMigration[];
  busy: boolean;
  onRollback(m: EfMigration): void;
  onRevertAll(): void;
}) {
  const newest = [...items].reverse();
  const newestApplied = newest.find((m) => m.applied === true)?.id;
  return (
    <>
      <ul aria-label="Migrations" className="space-y-1.5 text-xs">
        {newest.map((m) => {
          const state = APPLIED[String(m.applied) as keyof typeof APPLIED];
          return (
            <li
              key={m.id}
              aria-label={m.name}
              className="grid grid-cols-[6rem_minmax(0,1fr)_auto_auto] items-center gap-x-4"
            >
              <span className={cn('inline-flex items-center gap-1.5', TONE_TEXT[state.tone])}>
                <span aria-hidden className={cn('size-2 rounded-full', TONE_DOT[state.tone])} />
                {state.text}
              </span>
              <span className="truncate font-mono text-fg">{m.name}</span>
              <span className="font-mono text-fg-faint">{migrationDate(m.id)}</span>
              <span className="w-28 text-right">
                {m.applied === true && m.id !== newestApplied && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    disabled={busy}
                    onClick={() => onRollback(m)}
                  >
                    Update to here
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        disabled={busy}
        onClick={onRevertAll}
      >
        Revert all
      </Button>
    </>
  );
}

/**
 * EF Core's migrations for one environment (the Connections card's) and one DbContext: list, add, update,
 * script, remove. Rollbacks, remove and updates outside Development ask first; main refuses them otherwise.
 */
export function EfCard({
  projectId,
  ef,
  environment,
  running,
  onContext,
}: {
  projectId: string;
  ef: Ef;
  environment: string;
  running: DbStatus['running']['command'];
  onContext(context: string): void;
}) {
  const actions = useDatabaseActions(projectId);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const busy = running !== null;
  const send = (request: Request) =>
    actions.ef.mutate({
      ...request,
      environment,
      ...(ef.contexts.length > 1 && ef.context !== null ? { context: ef.context } : {}),
    });
  const isDevelopment = environment.toLowerCase() === 'development';
  const rollback = (target: string, name: string): Confirm => ({
    title: `Roll the ${environment} database back to ${name}?`,
    description: "Later migrations' Down steps run and can drop data.",
    action: 'Roll back',
    request: { action: 'update', target },
  });

  return (
    <section
      aria-label="EF Core"
      className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">
          EF Core
        </h3>
        {ef.tool && <span className="text-xs text-fg-faint">{ef.tool} tool</span>}
        {ef.contexts.length > 1 && (
          <label className="ml-auto flex items-center gap-2 text-xs text-fg-muted">
            DbContext
            <select
              aria-label="DbContext"
              value={ef.context ?? ''}
              onChange={(e) => onContext(e.target.value)}
              className={select}
            >
              {ef.contexts.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {ef.tool === null ? (
        <div className="space-y-2 text-xs text-fg-muted">
          <p>
            dotnet-ef isn't installed. NestBox never installs it; run this in the package folder:
          </p>
          <div className="flex items-center gap-2">
            <code className="rounded-md bg-app px-2 py-1 font-mono text-fg select-all">
              {EF_INSTALL_COMMAND}
            </code>
            <Button variant="ghost" size="sm" onClick={() => actions.copyInstallCommand.mutate()}>
              <Copy className="size-3.5" aria-hidden />
              Copy
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => send({ action: 'list' })}
            >
              {running === 'ef-list' ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Play className="size-3.5" aria-hidden />
              )}
              List migrations
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => setAdding(true)}>
              <FilePlus className="size-3.5" aria-hidden />
              Add migration…
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() =>
                isDevelopment
                  ? send({ action: 'update' })
                  : setConfirm({
                      title: `Apply pending migrations to the ${environment} database?`,
                      action: 'Update',
                      request: { action: 'update' },
                    })
              }
            >
              Update database
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => send({ action: 'script' })}
            >
              Script SQL
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() =>
                setConfirm({
                  title: "Remove the last migration's files from the project?",
                  action: 'Remove',
                  request: { action: 'remove' },
                })
              }
            >
              Remove last
            </Button>
            {ef.needsRestore && (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                title="dotnet tool restore: may download the tool"
                onClick={() => send({ action: 'restore' })}
              >
                Restore tools
              </Button>
            )}
            {running?.startsWith('ef-') && (
              <Button variant="ghost" size="sm" onClick={() => actions.stop.mutate('command')}>
                <Square className="size-3.5" aria-hidden />
                Stop
              </Button>
            )}
          </div>
          {ef.needsRestore && (
            <p className="text-xs text-warn">
              The local dotnet-ef isn't restored yet: run Restore tools.
            </p>
          )}
          {ef.migrations === null ? (
            <p className="text-xs text-fg-muted">List migrations to see which are applied.</p>
          ) : ef.migrations.items.length === 0 ? (
            <p className="text-xs text-fg-muted">No migrations yet.</p>
          ) : (
            <MigrationList
              items={ef.migrations.items}
              busy={busy}
              onRollback={(m) => setConfirm(rollback(m.id, m.name))}
              onRevertAll={() => setConfirm(rollback('0', 'before the first migration'))}
            />
          )}
        </>
      )}

      {adding && (
        <AddMigrationDialog
          onClose={() => setAdding(false)}
          onAdd={(name) => {
            setAdding(false);
            send({ action: 'add', name });
          }}
        />
      )}
      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.description ?? `Environment: ${environment}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-err text-fg hover:bg-err/90"
              onClick={() => {
                if (confirm) send({ ...confirm.request, confirmed: true });
              }}
            >
              {confirm?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
