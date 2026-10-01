import { NestboxError } from '@shared/errors';
import { notImplemented, type PlatformAdapter, type PlatformDeps } from './adapter';
import { normalizeWin32Path } from './paths';
import { assertCmdSafe, cmdInvocation, escapeWtArg } from './win32-escape';

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';
}

export function createWin32Adapter(deps: PlatformDeps): PlatformAdapter {
  return {
    id: 'win32',

    listListeningPorts: async () => notImplemented('listListeningPorts'),
    killTree: async () => notImplemented('killTree'),
    spawnScript: () => notImplemented('spawnScript'),

    /**
     * Runs the editor through cmd.exe, so a missing editor binary fails inside the console window.
     * This method only reports failures to start cmd.exe itself.
     */
    async openInEditor(path, line) {
      if (line !== undefined && !(Number.isInteger(line) && line > 0)) {
        throw new NestboxError('VALIDATION', 'Line must be a positive integer');
      }
      const editor = deps.getEditorCommand();
      const args = line === undefined ? [path] : ['-g', `${path}:${line}`];
      // Outside the try: a VALIDATION error from unsafe input must not become NOT_FOUND.
      const inv = cmdInvocation(editor, args);
      try {
        await deps.runner.launch(inv.file, inv.args, { verbatim: true, hidden: true });
      } catch {
        throw new NestboxError('INTERNAL', `Could not start the editor command "${editor}"`);
      }
    },

    async openTerminal(cwd, command) {
      if (command !== undefined) assertCmdSafe(command);
      const wtArgs = ['-d', escapeWtArg(cwd)];
      if (command !== undefined) wtArgs.push('cmd.exe', '/k', escapeWtArg(command));
      try {
        await deps.runner.launch('wt.exe', wtArgs);
        return;
      } catch (error) {
        if (!isEnoent(error)) throw new NestboxError('INTERNAL', 'Could not start Windows Terminal');
      }
      // Fallback: `start` gives the console its own window and handles (a detached cmd with
      // ignored stdio reads EOF and exits at once). The folder goes through cwd, never the command line.
      const line =
        command === undefined
          ? '/d /c start "" cmd.exe /d /k'
          : `/d /c start "" cmd.exe /d /s /k "${command}"`;
      try {
        await deps.runner.launch('cmd.exe', [line], { cwd, verbatim: true });
      } catch {
        throw new NestboxError('INTERNAL', 'Could not open a terminal');
      }
    },

    resolveShellEnv: async () => ({ ...process.env }),

    normalizePath: normalizeWin32Path,
    samePath: (a, b) => normalizeWin32Path(a) === normalizeWin32Path(b),

    windowChrome: (colors) => ({ titleBarStyle: 'hidden', titleBarOverlay: colors }),
  };
}
