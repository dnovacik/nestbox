import { X509Certificate } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMemoryLogger } from '../logger';
import { createLocalCa } from './ca';

const DAY = 86_400_000;
const dir = () => mkdtemp(join(tmpdir(), 'nestbox-ca-'));

describe('local CA', { timeout: 30_000 }, () => {
  it('makes a name-constrained root and leaves it signed, reused from disk', async () => {
    const file = join(await dir(), 'domains-ca.json');
    let now = Date.UTC(2026, 9, 14);
    const ca = createLocalCa({ file, now: () => now, logger: createMemoryLogger() });
    const root = await ca.root();
    const x = new X509Certificate(root.cert);
    expect(x.subject).toContain('CN=NestBox Local CA');
    expect(x.ca).toBe(true);
    expect(root.serialHex).toBe(new X509Certificate(root.cert).serialNumber.toLowerCase());
    expect(root.sha1).toMatch(/^[0-9a-f]{40}$/);
    const parsed = new (await import('@peculiar/x509')).X509Certificate(root.cert);
    expect(parsed.extensions.find((e) => e.type === '2.5.29.30')?.critical).toBe(true);
    const leaf = await ca.leaf('shop.localhost');
    const lx = new X509Certificate(leaf.cert);
    expect(lx.checkIssued(x)).toBe(true);
    expect(lx.subjectAltName).toBe('DNS:shop.localhost');
    // A second CA object on the same file reuses root and leaf.
    const again = createLocalCa({ file, now: () => now, logger: createMemoryLogger() });
    expect((await again.root()).sha1).toBe(root.sha1);
    expect((await again.leaf('shop.localhost')).cert).toBe(leaf.cert);
    // Within 30 days of expiry, the leaf is renewed; the root stays.
    now += 340 * DAY;
    expect((await again.leaf('shop.localhost')).cert).not.toBe(leaf.cert);
    expect((await again.root()).sha1).toBe(root.sha1);
  });

  it('never makes a leaf outside .localhost', async () => {
    const ca = createLocalCa({
      file: join(await dir(), 'ca.json'),
      now: Date.now,
      logger: createMemoryLogger(),
    });
    await expect(ca.leaf('example.com')).rejects.toThrow();
  });

  it('regenerates a corrupt file and says so (Review Focus 5)', async () => {
    const file = join(await dir(), 'domains-ca.json');
    await writeFile(file, '{"root":{"cert":"-----BEGIN');
    const ca = createLocalCa({ file, now: Date.now, logger: createMemoryLogger() });
    await ca.root();
    expect(ca.regenerated()).toBe(true);
    expect(JSON.parse(await readFile(file, 'utf8'))).toHaveProperty('root.cert');
  });

  it('shares one certificate per name across concurrent leaf() calls and keeps every name', async () => {
    const file = join(await dir(), 'ca.json');
    const ca = createLocalCa({ file, now: Date.now, logger: createMemoryLogger() });
    const names = [
      'a.localhost',
      'a.localhost',
      'a.localhost',
      'b.localhost',
      'c.localhost',
      'd.localhost',
    ];
    const leaves = await Promise.all(names.map((n) => ca.leaf(n)));
    expect(leaves[1]?.cert).toBe(leaves[0]?.cert);
    expect(leaves[2]?.cert).toBe(leaves[0]?.cert);
    const saved = JSON.parse(await readFile(file, 'utf8')) as { leaves: Record<string, unknown> };
    expect(Object.keys(saved.leaves).sort()).toEqual([
      'a.localhost',
      'b.localhost',
      'c.localhost',
      'd.localhost',
    ]);
  });

  it('reset() beats work in flight', async () => {
    const file = join(await dir(), 'ca.json');
    const ca = createLocalCa({ file, now: Date.now, logger: createMemoryLogger() });
    const first = ca.root();
    await ca.reset();
    const second = await ca.root();
    await first.catch(() => undefined);
    expect((await ca.root()).sha1).toBe(second.sha1);
    const saved = JSON.parse(await readFile(file, 'utf8')) as { root: { sha1: string } };
    expect(saved.root.sha1).toBe(second.sha1);
  });
});
