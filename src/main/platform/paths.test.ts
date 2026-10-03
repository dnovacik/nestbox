import { describe, expect, it } from 'vitest';
import { normalizeDarwinPath, normalizePosixPath, normalizeWin32Path } from './paths';

describe('normalizeWin32Path', () => {
  it('lower-cases and strips trailing separators', () => {
    expect(normalizeWin32Path('C:\\Dev\\Shop\\')).toBe('c:\\dev\\shop');
    expect(normalizeWin32Path('c:/dev/shop')).toBe('c:\\dev\\shop');
  });

  it('keeps a drive root intact', () => {
    expect(normalizeWin32Path('D:\\')).toBe('d:\\');
  });

  it('resolves dot segments', () => {
    expect(normalizeWin32Path('C:\\Dev\\x\\..\\Shop')).toBe('c:\\dev\\shop');
  });
});

describe('normalizePosixPath', () => {
  it('keeps case and strips trailing slash', () => {
    expect(normalizePosixPath('/Users/Me/Shop/')).toBe('/Users/Me/Shop');
    expect(normalizePosixPath('/')).toBe('/');
  });
});

describe('normalizeDarwinPath', () => {
  it('compares case-insensitively, like a default APFS volume', () => {
    expect(normalizeDarwinPath('/Users/Me/Shop/')).toBe('/users/me/shop');
    expect(normalizeDarwinPath('/')).toBe('/');
  });

  it('treats composed and decomposed accents as the same name', () => {
    expect(normalizeDarwinPath('/Users/me/Caf\u00e9')).toBe(normalizeDarwinPath('/Users/me/Cafe\u0301'));
  });

  it('resolves dot segments', () => {
    expect(normalizeDarwinPath('/Users/me/x/../Shop')).toBe('/users/me/shop');
  });
});
