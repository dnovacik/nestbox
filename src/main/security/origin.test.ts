import { describe, expect, it } from 'vitest';
import { isAppUrl } from './origin';

const dev = { devServerUrl: 'http://localhost:5173' };
const entry = { entryFileUrl: 'file:///C:/app/out/renderer/index.html' };

describe('isAppUrl', () => {
  it('accepts the dev server origin in dev', () => {
    expect(isAppUrl('http://localhost:5173/', dev)).toBe(true);
    expect(isAppUrl('http://localhost:5173/index.html#x', dev)).toBe(true);
  });

  it('rejects other origins in dev, including file:', () => {
    expect(isAppUrl('http://localhost:5174/', dev)).toBe(false);
    expect(isAppUrl('file:///C:/app/index.html', { ...dev, ...entry })).toBe(false);
  });

  it('accepts only the exact entry file when packaged, ignoring query and hash', () => {
    expect(isAppUrl('file:///C:/app/out/renderer/index.html', entry)).toBe(true);
    expect(isAppUrl('file:///C:/app/out/renderer/index.html#/x', entry)).toBe(true);
    expect(isAppUrl('file:///C:/app/out/renderer/index.html?a=1', entry)).toBe(true);
    expect(isAppUrl('file:///c:/APP/out/renderer/Index.html', entry)).toBe(true);
  });

  it('rejects other files, siblings, UNC paths and other schemes when packaged', () => {
    expect(isAppUrl('file:///C:/other.html', entry)).toBe(false);
    expect(isAppUrl('file:///C:/app/out/renderer/evil.html', entry)).toBe(false);
    expect(isAppUrl('file://host/share/index.html', entry)).toBe(false);
    expect(isAppUrl('https://example.com/', entry)).toBe(false);
  });

  it('rejects everything when neither option is given', () => {
    expect(isAppUrl('file:///C:/app/out/renderer/index.html', {})).toBe(false);
    expect(isAppUrl('http://localhost:5173/', {})).toBe(false);
  });

  it('rejects garbage', () => {
    expect(isAppUrl('', entry)).toBe(false);
    expect(isAppUrl('not a url', dev)).toBe(false);
  });
});
