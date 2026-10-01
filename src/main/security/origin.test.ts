import { describe, expect, it } from 'vitest';
import { isAppUrl } from './origin';

describe('isAppUrl', () => {
  it('accepts the dev server origin in dev', () => {
    expect(isAppUrl('http://localhost:5173/', 'http://localhost:5173')).toBe(true);
    expect(isAppUrl('http://localhost:5173/index.html#x', 'http://localhost:5173')).toBe(true);
  });

  it('rejects other origins in dev, including file:', () => {
    expect(isAppUrl('http://localhost:5174/', 'http://localhost:5173')).toBe(false);
    expect(isAppUrl('file:///C:/app/index.html', 'http://localhost:5173')).toBe(false);
  });

  it('accepts only file: URLs when packaged', () => {
    expect(isAppUrl('file:///C:/Program%20Files/Nestbox/resources/app.asar/out/renderer/index.html')).toBe(true);
    expect(isAppUrl('https://example.com/')).toBe(false);
  });

  it('rejects garbage', () => {
    expect(isAppUrl('')).toBe(false);
    expect(isAppUrl('not a url', 'http://localhost:5173')).toBe(false);
  });
});
