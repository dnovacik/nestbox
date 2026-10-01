// Escaping for Windows process launches. Mirrors cross-spawn's lib/util/escape.js.

import { NestboxError } from '@shared/errors';

/** Characters cmd.exe treats specially. Includes the quote so cmd never enters quote mode. */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/** Quote one argument with the MSVCRT / CommandLineToArgvW rules. Always quotes. */
export function quoteWindowsArg(arg: string): string {
  let out = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === '\\') {
      backslashes++;
      continue;
    }
    if (ch === '"') {
      out += '\\'.repeat(backslashes * 2 + 1) + '"';
    } else {
      out += '\\'.repeat(backslashes) + ch;
    }
    backslashes = 0;
  }
  return out + '\\'.repeat(backslashes * 2) + '"';
}

/** Escape one argument for a cmd.exe command line. */
export function escapeCmdArg(arg: string): string {
  return quoteWindowsArg(arg).replace(CMD_META, '^$1');
}

/** Escape the command (program) part of a cmd.exe command line. */
export function escapeCmdCommand(command: string): string {
  return command.replace(CMD_META, '^$1');
}

/** Characters that cannot be passed safely through cmd.exe and a .cmd shim's `%*` re-parse. */
const UNSAFE_FOR_CMD = /["\r\n\0]/;

/**
 * Arguments for spawning `command args...` through cmd.exe. Spawn with windowsVerbatimArguments: true.
 * For paths and Nestbox-built tokens only. Throws on `"`, CR, LF and NUL, because a .cmd shim
 * re-parses `%*` and treats `\"` as closing the quote (argument injection).
 */
export function cmdInvocation(
  command: string,
  args: readonly string[],
): { file: 'cmd.exe'; args: string[] } {
  if (UNSAFE_FOR_CMD.test(command) || args.some((a) => UNSAFE_FOR_CMD.test(a))) {
    throw new NestboxError(
      'VALIDATION',
      'Argument contains a character that cannot be passed safely to cmd.exe',
    );
  }
  const line = [escapeCmdCommand(command), ...args.map(escapeCmdArg)].join(' ');
  return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`] };
}

/** Windows Terminal splits its command line on ';' — escape literal semicolons. */
export function escapeWtArg(arg: string): string {
  return arg.replace(/;/g, '\\;');
}
