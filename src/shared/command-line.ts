import { z } from 'zod';

export const MAX_COMMAND_ARGS = 64;
export const MAX_COMMAND_ARG_LENGTH = 1_000;

/** A leading `KEY=value`: an env assignment, which would put a value in the settings. */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** What cmd.exe can't take safely (see assertCmdSafe); a command is also a single line. */
const UNSAFE = /["\r\n\0]/;

const ArgSchema = z
  .string()
  .max(MAX_COMMAND_ARG_LENGTH)
  .refine((arg) => !UNSAFE.test(arg), 'An argument cannot contain a double quote or a line break');

/** A custom command: a program and its arguments, run without a shell. */
export const CommandArgvSchema = z
  .array(ArgSchema)
  .min(1)
  .max(MAX_COMMAND_ARGS)
  .refine(
    ([program]) => program !== undefined && program !== '' && !ENV_ASSIGNMENT.test(program),
    'Not a program',
  );

export type SplitResult = { ok: true; argv: string[] } | { ok: false; error: string };

/**
 * Splits a typed command line into a program and its arguments: whitespace separates, `'…'` and `"…"`
 * group. Nothing else is special: `&&`, `|`, `>` and `$VAR` are passed literally, the same on every platform.
 */
export function splitCommandLine(line: string): SplitResult {
  if (/[\r\n]/.test(line)) return { ok: false, error: 'A command is one line.' };
  const argv: string[] = [];
  let current: string | null = null;
  let quote: "'" | '"' | null = null;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      current ??= '';
    } else if (/\s/.test(ch)) {
      if (current !== null) argv.push(current);
      current = null;
    } else {
      current = (current ?? '') + ch;
    }
  }
  if (quote) return { ok: false, error: 'A quote is not closed.' };
  if (current !== null) argv.push(current);
  if (argv.length === 0) return { ok: false, error: 'Type a command.' };
  if (ENV_ASSIGNMENT.test(argv[0] ?? '')) {
    return { ok: false, error: 'Put environment variables in .env, not in the command.' };
  }
  if (argv.length > MAX_COMMAND_ARGS) {
    return { ok: false, error: `At most ${MAX_COMMAND_ARGS} arguments.` };
  }
  if (argv.some((a) => a.length > MAX_COMMAND_ARG_LENGTH)) {
    return { ok: false, error: 'An argument is longer than 1,000 characters.' };
  }
  if (argv.some((a) => UNSAFE.test(a))) {
    return { ok: false, error: 'An argument cannot contain a double quote.' };
  }
  return { ok: true, argv };
}

/** The command as one line, quoted so that splitCommandLine gives the same argv back. */
export function formatCommandLine(argv: readonly string[]): string {
  return argv
    .map((arg) => {
      if (arg !== '' && !/[\s'"]/.test(arg)) return arg;
      return arg.includes('"') ? `'${arg}'` : `"${arg}"`;
    })
    .join(' ');
}
