import { useState } from 'react';
import { EditorCommandSchema, LogBufferLinesSchema, type SettingsPatch, type SettingsView } from '@shared/settings';
import type { TrayIconTheme } from '@shared/types';
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
import { Switch } from '@/components/ui/switch';
import { useSettings, useUpdateSettings } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/state/ui-store';

const selectClass =
  'h-8 rounded-md border border-line bg-app px-2 text-sm text-fg focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50';

const THEMES: { value: TrayIconTheme; label: string }[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'dark-taskbar', label: 'Dark taskbar' },
  { value: 'light-taskbar', label: 'Light taskbar' },
];

function Row({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] items-start gap-4">
      <label htmlFor={htmlFor} className="pt-1.5 text-sm text-fg">
        {label}
      </label>
      <div className="space-y-1">
        {children}
        {hint && <p className="text-[11px] text-fg-muted">{hint}</p>}
      </div>
    </div>
  );
}

function SettingsForm({ initial, onDone }: { initial: SettingsView; onDone(): void }) {
  const update = useUpdateSettings();
  const [closeToTray, setCloseToTray] = useState(initial.closeToTray);
  const [trayIconTheme, setTrayIconTheme] = useState(initial.trayIconTheme);
  const [logBufferLines, setLogBufferLines] = useState(String(initial.logBufferLines));
  const [editorCommand, setEditorCommand] = useState(initial.editorCommand);
  const readOnly = initial.readOnly;

  const buffer = Number(logBufferLines);
  const bufferError = LogBufferLinesSchema.safeParse(buffer).success ? null : 'Between 1 000 and 1 000 000 lines';
  const editorParse = EditorCommandSchema.safeParse(editorCommand);
  const editorError = editorParse.success ? null : /["\r\n\0]/.test(editorCommand) ? 'Quotes are not allowed' : 'Enter a command';

  const patch: SettingsPatch = {};
  if (closeToTray !== initial.closeToTray) patch.closeToTray = closeToTray;
  if (trayIconTheme !== initial.trayIconTheme) patch.trayIconTheme = trayIconTheme;
  if (!bufferError && buffer !== initial.logBufferLines) patch.logBufferLines = buffer;
  if (editorParse.success && editorParse.data !== initial.editorCommand) patch.editorCommand = editorParse.data;
  const canSave = !readOnly && !bufferError && !editorError && Object.keys(patch).length > 0 && !update.isPending;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) update.mutate(patch, { onSuccess: onDone });
      }}
    >
      {readOnly && (
        <p className="rounded-md border border-warn/30 bg-warn/10 p-2 text-xs text-warn">
          Settings are read-only because the settings file couldn't be saved or comes from a newer Nestbox.
        </p>
      )}
      <fieldset disabled={readOnly} className="space-y-4">
        <Row label="Close to tray" htmlFor="settings-close-to-tray" hint="Closing the window keeps Nestbox and your scripts running in the tray.">
          <Switch id="settings-close-to-tray" checked={closeToTray} onCheckedChange={setCloseToTray} disabled={readOnly} />
        </Row>
        <Row label="Tray icon theme" htmlFor="settings-tray-theme" hint="Pick the set that stays visible on your taskbar.">
          <select
            id="settings-tray-theme"
            className={selectClass}
            value={trayIconTheme}
            onChange={(e) => setTrayIconTheme(e.target.value as TrayIconTheme)}
          >
            {THEMES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Log buffer" htmlFor="settings-log-buffer" hint="Lines kept per script, 1 000–1 000 000. Applies to scripts started afterwards.">
          <Input
            id="settings-log-buffer"
            type="number"
            inputMode="numeric"
            value={logBufferLines}
            aria-invalid={bufferError !== null}
            onChange={(e) => setLogBufferLines(e.target.value)}
            className={cn('h-8 w-40 text-sm', bufferError && 'border-err')}
          />
          {bufferError && <p className="text-[11px] text-err">{bufferError}</p>}
        </Row>
        <Row label="Editor command" htmlFor="settings-editor" hint="Used by Open in VS Code and log links.">
          <Input
            id="settings-editor"
            value={editorCommand}
            aria-invalid={editorError !== null}
            onChange={(e) => setEditorCommand(e.target.value)}
            className={cn('h-8 font-mono text-sm', editorError && 'border-err')}
          />
          {editorError && <p className="text-[11px] text-err">{editorError}</p>}
        </Row>
      </fieldset>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

export function SettingsDialog() {
  const open = useUiStore((s) => s.settingsOpen);
  const setOpen = useUiStore((s) => s.setSettingsOpen);
  const { data, isError } = useSettings();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Nestbox keeps these on this computer only.</DialogDescription>
        </DialogHeader>
        {data ? (
          <SettingsForm key={JSON.stringify(data)} initial={data} onDone={() => setOpen(false)} />
        ) : isError ? (
          <p className="text-sm text-err">Couldn't load the settings.</p>
        ) : (
          <p className="text-sm text-fg-muted">Loading…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
