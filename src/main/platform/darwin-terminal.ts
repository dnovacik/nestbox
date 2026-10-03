// Opening a terminal on macOS without AppleScript (no Automation permission prompt). Pure helpers, tested
// everywhere; darwin.ts does the file and process work.
import { NestboxError } from '@shared/errors';

export type MacTerminal = 'terminal' | 'iterm' | 'ghostty';

const APP_NAMES: Record<MacTerminal, string> = { terminal: 'Terminal', iterm: 'iTerm', ghostty: 'Ghostty' };

/** The setting's app, or for auto (and anything that isn't a macOS terminal) iTerm2 when installed, else Terminal. */
export function chooseTerminal(setting: string, installed: { iterm: boolean; ghostty: boolean }): MacTerminal {
  if (setting === 'terminal' || setting === 'iterm' || setting === 'ghostty') return setting;
  return installed.iterm ? 'iterm' : 'terminal';
}

/** A single-quoted POSIX shell word: nothing inside is expanded. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Terminal commands are NestBox-built (`claude`, `claude --continue`): plain words only. */
export function assertTerminalCommand(command: string): void {
  if (!/^[A-Za-z0-9 _.:/=@+-]+$/.test(command)) throw new NestboxError('VALIDATION', 'Unsupported terminal command');
}

/**
 * The .command file Terminal and iTerm run: it deletes itself first, so nothing is left behind, then runs the
 * command in the folder and leaves a login shell open, as a terminal window would.
 */
export function commandFileScript(cwd: string, command: string): string {
  return ['#!/bin/sh', 'rm -f "$0"', `cd ${shellQuote(cwd)} || exit 1`, command, 'exec "${SHELL:-/bin/zsh}" -l', ''].join('\n');
}

/** The user's login shell for commands Ghostty runs: $SHELL when it is a plain absolute path, else zsh. */
export function loginShell(shell: string | undefined): string {
  return shell !== undefined && /^\/[A-Za-z0-9_./+-]+$/.test(shell) ? shell : '/bin/zsh';
}

/** Arguments for /usr/bin/open. */
export function openArgs(app: MacTerminal, target: { cwd: string; command?: string; commandFile?: string; shell?: string }): string[] {
  if (app === 'ghostty') {
    const args = ['-na', 'Ghostty', '--args', `--working-directory=${target.cwd}`];
    if (target.command === undefined) return args;
    // Through the login shell, so the profile's PATH applies (as with a .command file), then a shell stays open.
    const shell = loginShell(target.shell);
    return [...args, '-e', shell, '-lic', `${target.command}; exec ${shellQuote(shell)} -l`];
  }
  return ['-a', APP_NAMES[app], target.commandFile ?? target.cwd];
}
