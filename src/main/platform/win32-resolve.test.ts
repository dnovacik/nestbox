import { describe, expect, it } from 'vitest';
import { resolveOnPath } from './win32-resolve';

const files = (list: string[]) => (path: string) =>
  list.map((f) => f.toLowerCase()).includes(path.toLowerCase());

describe('resolveOnPath', () => {
  const env = {
    Path: 'C:\\Windows\\System32;C:\\Program Files\\nodejs;C:\\Users\\dan\\AppData\\Roaming\\npm',
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
  };

  it('finds a command in PATH order with PATHEXT', () => {
    const isFile = files([
      'C:\\Users\\dan\\AppData\\Roaming\\npm\\claude.cmd',
      'C:\\Program Files\\nodejs\\npx.cmd',
    ]);
    expect(resolveOnPath('claude', env, isFile)).toBe(
      'C:\\Users\\dan\\AppData\\Roaming\\npm\\claude.cmd',
    );
    expect(resolveOnPath('npx', env, isFile)).toBe('C:\\Program Files\\nodejs\\npx.cmd');
  });

  it('prefers .exe over .cmd in the same folder, as cmd.exe does', () => {
    const isFile = files([
      'C:\\Program Files\\nodejs\\docker.cmd',
      'C:\\Program Files\\nodejs\\docker.exe',
    ]);
    expect(resolveOnPath('docker', env, isFile)).toBe('C:\\Program Files\\nodejs\\docker.exe');
  });

  it('never looks in the current folder or in relative PATH entries', () => {
    const isFile = files(['claude.cmd', '.\\claude.cmd', 'bin\\claude.cmd']);
    expect(
      resolveOnPath('claude', { PATH: '.;bin;;\\share\\x', PATHEXT: '.CMD' }, isFile),
    ).toBeNull();
  });

  it('accepts quoted PATH entries and a command that already has an extension', () => {
    const isFile = files(['C:\\Tools\\git.exe']);
    expect(resolveOnPath('git.exe', { PATH: '"C:\\Tools"' }, isFile)).toBe('C:\\Tools\\git.exe');
  });

  it('returns a path as it is', () => {
    expect(resolveOnPath('C:\\x\\tool.exe', env, () => false)).toBe('C:\\x\\tool.exe');
  });
});
