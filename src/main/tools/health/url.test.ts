import { describe, expect, it } from 'vitest';
import { HttpUrlSchema } from '@shared/tools/health/contract';
import { describeHttpUrl, envCheckUrl } from './url';

describe('HttpUrlSchema', () => {
  it.each(['http://localhost:3000/', 'https://api.example.com/health?x=1', 'http://[::1]:8080/ready'])('accepts %s', (url) => {
    expect(HttpUrlSchema.safeParse(url).success).toBe(true);
  });

  it.each(['ftp://x/', 'file:///etc/passwd', 'javascript:alert(1)', 'http://user:pass@host/', 'http://user@host/', 'not a url', `http://x/${'a'.repeat(2001)}`])('refuses %s', (url) => {
    expect(HttpUrlSchema.safeParse(url).success).toBe(false);
  });
});

describe('describeHttpUrl', () => {
  it('keeps the origin, without credentials or query', () => {
    expect(describeHttpUrl('https://u:s3cr3t@api.local:4000/v1?token=s3cr3t')).toBe('api.local:4000');
    expect(describeHttpUrl('http://localhost/')).toBe('localhost');
    expect(describeHttpUrl('http://[::1]:5173/')).toBe('[::1]:5173');
  });

  it('is null for anything that is not http(s)', () => {
    expect(describeHttpUrl('postgresql://u:p@db/x')).toBeNull();
    expect(describeHttpUrl('garbage')).toBeNull();
  });
});

describe('envCheckUrl', () => {
  it("joins the value's origin with the check's path, dropping credentials and the query", () => {
    expect(envCheckUrl('https://u:s3cr3t@api.local:4000/v1?token=s3cr3t', '/health')).toEqual({ ok: true, url: 'https://api.local:4000/health', host: 'api.local:4000' });
  });

  it('says why an unusable value cannot be checked, without the value', () => {
    expect(envCheckUrl(undefined, '/')).toEqual({ ok: false, reason: 'not set in .env' });
    expect(envCheckUrl('', '/')).toEqual({ ok: false, reason: 'not set in .env' });
    expect(envCheckUrl('redis://s3cr3t@x:6379', '/')).toEqual({ ok: false, reason: 'not an http(s) URL' });
  });
});
