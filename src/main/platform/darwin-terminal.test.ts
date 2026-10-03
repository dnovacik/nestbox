import { describe, expect, it } from 'vitest';
import { assertTerminalCommand, chooseTerminal, commandFileScript, openArgs, shellQuote } from './darwin-terminal';

describe('chooseTerminal', () => {
  it('prefers iTerm2 on auto when it is installed', () => {
    expect(chooseTerminal('auto', { iterm: true, ghostty: true })).toBe('iterm');
    expect(chooseTerminal('auto', { iterm: false, ghostty: true })).toBe('terminal');
  });

  it('keeps an explicit macOS choice, and treats Windows or unknown values as auto', () => {
    expect(chooseTerminal('ghostty', { iterm: true, ghostty: true })).toBe('ghostty');
    expect(chooseTerminal('terminal', { iterm: true, ghostty: false })).toBe('terminal');
    expect(chooseTerminal('cmd', { iterm: false, ghostty: false })).toBe('terminal');
    expect(chooseTerminal('nonsense', { iterm: true, ghostty: false })).toBe('iterm');
  });
});

describe('shellQuote', () => {
  it.each([
    ['/Users/me/shop', "'/Users/me/shop'"],
    ["/Users/me/it's here", "'/Users/me/it'\\''s here'"],
    ['/Users/me/$HOME `x` "y"', "'/Users/me/$HOME `x` \"y\"'"],
  ])('%s', (input, quoted) => {
    expect(shellQuote(input)).toBe(quoted);
  });
});

describe('commandFileScript', () => {
  it('removes itself, enters the folder, runs the command and leaves a shell open', () => {
    expect(commandFileScript("/Users/me/my shop's", 'claude --continue')).toBe(
      ['#!/bin/sh', 'rm -f "$0"', "cd '/Users/me/my shop'\\''s' || exit 1", 'claude --continue', 'exec "${SHELL:-/bin/zsh}" -l', ''].join('\n'),
    );
  });
});

describe('assertTerminalCommand', () => {
  it('accepts NestBox-built commands', () => {
    expect(() => assertTerminalCommand('claude --continue')).not.toThrow();
  });

  it.each(['claude; rm -rf ~', 'claude $(id)', 'a\nb', "it's", 'x|y', 'a && b'])('refuses %j', (command) => {
    expect(() => assertTerminalCommand(command)).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
  });
});

describe('openArgs', () => {
  it('opens a folder in Terminal or iTerm', () => {
    expect(openArgs('terminal', { cwd: '/Users/me/shop' })).toEqual(['-a', 'Terminal', '/Users/me/shop']);
    expect(openArgs('iterm', { cwd: '/Users/me/shop' })).toEqual(['-a', 'iTerm', '/Users/me/shop']);
  });

  it('runs a command through the .command file', () => {
    expect(openArgs('terminal', { cwd: '/x', commandFile: '/tmp/a.command' })).toEqual(['-a', 'Terminal', '/tmp/a.command']);
  });

  it('gives Ghostty the folder and the command words as arguments', () => {
    expect(openArgs('ghostty', { cwd: '/Users/me/shop' })).toEqual(['-na', 'Ghostty', '--args', '--working-directory=/Users/me/shop']);
    expect(openArgs('ghostty', { cwd: '/x', command: 'claude --continue' })).toEqual([
      '-na',
      'Ghostty',
      '--args',
      '--working-directory=/x',
      '-e',
      'claude',
      '--continue',
    ]);
  });
});
