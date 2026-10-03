import { useState } from 'react';
import { EditorCommandSchema, LogBufferLinesSchema, parsePortList, type SettingsPatch, type SettingsView } from '@shared/settings';
import { type PlatformId, type TerminalApp, TERMINALS_BY_PLATFORM, type TrayIconTheme } from '@shared/types';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useAppInfo, useSettings, useUpdateSettings } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/state/ui-store';


const THEMES: { value: TrayIconTheme; label: string }[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'dark-taskbar', label: 'Dark taskbar' },
  { value: 'light-taskbar', label: 'Light taskbar' },
];

const TERMINAL_LABELS: Record<TerminalApp, string> = {
  auto: 'Automatic',
  'windows-terminal': 'Windows Terminal',
  cmd: 'Command Prompt',
  terminal: 'Terminal',
  iterm: 'iTerm2',
  ghostty: 'Ghostty',
};

const TERMINAL_HINTS: Record<PlatformId, string> = {
  win32: 'Automatic uses Windows Terminal when it is installed, otherwise Command Prompt.',
  darwin: 'Automatic uses iTerm2 when it is installed, otherwise Terminal.',
};

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

function SettingsForm({ initial, platform, onDone }: { initial: SettingsView; platform: PlatformId; onDone(): void }) {
  const update = useUpdateSettings();
  const terminals: readonly TerminalApp[] = TERMINALS_BY_PLATFORM[platform];
  // A stored value from the other platform (or an old free-text one) shows as Automatic, which is what it means.
  const initialTerminal: TerminalApp = (terminals as readonly string[]).includes(initial.terminalApp) ? (initial.terminalApp as TerminalApp) : 'auto';
  const [terminalApp, setTerminalApp] = useState<TerminalApp>(initialTerminal);
  const [closeToTray, setCloseToTray] = useState(initial.closeToTray);
  const [trayIconTheme, setTrayIconTheme] = useState(initial.trayIconTheme);
  const [logBufferLines, setLogBufferLines] = useState(String(initial.logBufferLines));
  const [editorCommand, setEditorCommand] = useState(initial.editorCommand);
  const [watchedPorts, setWatchedPorts] = useState(initial.watchedPorts.join(', '));
  const readOnly = initial.readOnly;

  const buffer = Number(logBufferLines);
  const bufferError = LogBufferLinesSchema.safeParse(buffer).success ? null : 'Between 1 000 and 1 000 000 lines';
  const editorParse = EditorCommandSchema.safeParse(editorCommand);
  const editorError = editorParse.success ? null : /["\r\n\0]/.test(editorCommand) ? 'Quotes are not allowed' : 'Enter a command';

  const ports = parsePortList(watchedPorts);
  const portsError = ports === null ? 'Ports between 1 and 65535, separated by commas' : null;

  const patch: SettingsPatch = {};
  if (closeToTray !== initial.closeToTray) patch.closeToTray = closeToTray;
  if (trayIconTheme !== initial.trayIconTheme) patch.trayIconTheme = trayIconTheme;
  if (!bufferError && buffer !== initial.logBufferLines) patch.logBufferLines = buffer;
  if (editorParse.success && editorParse.data !== initial.editorCommand) patch.editorCommand = editorParse.data;
  if (ports && ports.join(',') !== initial.watchedPorts.join(',')) patch.watchedPorts = ports;
  if (terminalApp !== initialTerminal) patch.terminalApp = terminalApp;
  const canSave = !readOnly && !bufferError && !editorError && !portsError && Object.keys(patch).length > 0 && !update.isPending;

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
          Settings are read-only because the settings file couldn't be saved or comes from a newer NestBox.
        </p>
      )}
      <fieldset disabled={readOnly} className="space-y-4">
        <Row label="Close to tray" htmlFor="settings-close-to-tray" hint="Closing the window keeps NestBox and your scripts running in the tray.">
          <Switch id="settings-close-to-tray" checked={closeToTray} onCheckedChange={setCloseToTray} disabled={readOnly} />
        </Row>
        {/* macOS: the menu bar follows the system appearance, so the icon always does too ('auto'). */}
        {platform === 'win32' && (
          <Row label="Tray icon theme" htmlFor="settings-tray-theme" hint="Pick the set that stays visible on your taskbar.">
            <Select value={trayIconTheme} onValueChange={(value) => setTrayIconTheme(value as TrayIconTheme)} disabled={readOnly}>
              <SelectTrigger id="settings-tray-theme" size="sm" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THEMES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
        )}
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
        <Row label="Terminal" htmlFor="settings-terminal" hint={TERMINAL_HINTS[platform]}>
          <Select value={terminalApp} onValueChange={(value) => setTerminalApp(value as TerminalApp)} disabled={readOnly}>
            <SelectTrigger id="settings-terminal" size="sm" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {terminals.map((t) => (
                <SelectItem key={t} value={t}>
                  {TERMINAL_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="Watched ports" htmlFor="settings-watched-ports" hint="Shown on each project's Overview, free or in use.">
          <Input
            id="settings-watched-ports"
            value={watchedPorts}
            aria-invalid={portsError !== null}
            onChange={(e) => setWatchedPorts(e.target.value)}
            className={cn('h-8 font-mono text-sm', portsError && 'border-err')}
          />
          {portsError && <p className="text-[11px] text-err">{portsError}</p>}
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
  const { data: info, isError: infoError } = useAppInfo();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>NestBox keeps these on this computer only.</DialogDescription>
        </DialogHeader>
        {data && info ? (
          <SettingsForm key={JSON.stringify(data)} initial={data} platform={info.platform} onDone={() => setOpen(false)} />
        ) : isError || infoError ? (
          <p className="text-sm text-err">Couldn't load the settings.</p>
        ) : (
          <p className="text-sm text-fg-muted">Loading…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
