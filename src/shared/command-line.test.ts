import { describe, expect, it } from 'vitest';
import { CommandArgvSchema, formatCommandLine, splitCommandLine } from './command-line';

describe('splitCommandLine', () => {
  it('splits on whitespace and groups quoted parts', () => {
    expect(splitCommandLine('  uvicorn app.main:app   --reload --port 8000 ')).toEqual({
      ok: true,
      argv: ['uvicorn', 'app.main:app', '--reload', '--port', '8000'],
    });
    expect(splitCommandLine(`python "my script.py" --name='a b'c`)).toEqual({
      ok: true,
      argv: ['python', 'my script.py', '--name=a bc'],
    });
    expect(splitCommandLine(`echo ""`)).toEqual({ ok: true, argv: ['echo', ''] });
  });

  it('keeps shell characters literal', () => {
    expect(splitCommandLine('a && b | c > d $HOME %PATH%')).toEqual({
      ok: true,
      argv: ['a', '&&', 'b', '|', 'c', '>', 'd', '$HOME', '%PATH%'],
    });
  });

  it('refuses what cannot run safely', () => {
    expect(splitCommandLine('   ')).toEqual({ ok: false, error: 'Type a command.' });
    expect(splitCommandLine('python "main.py')).toEqual({
      ok: false,
      error: 'A quote is not closed.',
    });
    expect(splitCommandLine(`echo 'say "hi"'`)).toEqual({
      ok: false,
      error: 'An argument cannot contain a double quote.',
    });
    expect(splitCommandLine('PORT=8000 python main.py')).toEqual({
      ok: false,
      error: 'Put environment variables in .env, not in the command.',
    });
    expect(splitCommandLine('a\nb')).toEqual({ ok: false, error: 'A command is one line.' });
    expect(splitCommandLine(Array(65).fill('x').join(' '))).toEqual({
      ok: false,
      error: 'At most 64 arguments.',
    });
    expect(splitCommandLine(`x ${'y'.repeat(1001)}`)).toEqual({
      ok: false,
      error: 'An argument is longer than 1,000 characters.',
    });
  });
});

describe('formatCommandLine', () => {
  it('quotes arguments that need it, so it splits back to the same argv', () => {
    const argv = ['python', 'my script.py', '', "it's", '--x'];
    const line = formatCommandLine(argv);
    expect(line).toBe(`python "my script.py" "" "it's" --x`);
    expect(splitCommandLine(line)).toEqual({ ok: true, argv });
  });
});

describe('CommandArgvSchema', () => {
  it('takes what splitCommandLine produces and refuses the rest', () => {
    expect(CommandArgvSchema.safeParse(['python', 'main.py']).success).toBe(true);
    expect(CommandArgvSchema.safeParse([]).success).toBe(false);
    expect(CommandArgvSchema.safeParse(['a"b']).success).toBe(false);
    expect(CommandArgvSchema.safeParse(['FOO=1', 'x']).success).toBe(false);
    expect(CommandArgvSchema.safeParse(['', 'x']).success).toBe(false);
  });
});
