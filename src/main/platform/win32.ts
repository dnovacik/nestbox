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
        await deps.runner.launch(inv.file, inv.args, { verbatim: true });
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
      // Fallback: plain console. The folder goes through the process cwd, never the command line.
      // With a command, /s strips the outer quotes so cmd runs the Nestbox-built line as-is.
      const [args, opts] =
        command === undefined
          ? [['/d', '/k'], { cwd }]
          : [['/d', '/s', '/k', `"${command}"`], { cwd, verbatim: true }];
      try {
        await deps.runner.launch('cmd.exe', args, opts);
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
