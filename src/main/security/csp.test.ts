import { describe, expect, it } from 'vitest';
import { buildCsp } from './csp';

describe('buildCsp', () => {
  it('is strict in production', () => {
    const csp = buildCsp({ dev: false });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/https?:/);
  });

  it('only relaxes what Vite HMR needs in dev', () => {
    const csp = buildCsp({ dev: true });
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain('ws://localhost:*');
    expect(csp).not.toContain('unsafe-eval');
  });
});
