import { X509Certificate, webcrypto } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tls from 'node:tls';
import { AsnConvert } from '@peculiar/asn1-schema';
import { NameConstraints } from '@peculiar/asn1-x509';
import * as x509 from '@peculiar/x509';
import { describe, expect, it } from 'vitest';
import { createMemoryLogger } from '../logger';
import { createLocalCa } from './ca';

const DAY = 86_400_000;
const dir = () => mkdtemp(join(tmpdir(), 'nestbox-ca-'));
const ALG = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 2048,
} as const;

const pemBody = (pem: string) => Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ''), 'base64');

// Signs a leaf with the root's key, bypassing the CA's own .localhost check (what a leaked key could do).
async function forgeLeaf(
  root: { cert: string; key: string },
  san: x509.JsonGeneralName,
): Promise<{ cert: string; key: string }> {
  const keys = (await webcrypto.subtle.generateKey(ALG, true, [
    'sign',
    'verify',
  ])) as webcrypto.CryptoKeyPair;
  const signingKey = await webcrypto.subtle.importKey('pkcs8', pemBody(root.key), ALG, false, [
    'sign',
  ]);
  const issuer = new x509.X509Certificate(root.cert);
  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: '01',
    subject: 'CN=forged',
    issuer: issuer.subject,
    notBefore: new Date(Date.now() - DAY),
    notAfter: new Date(Date.now() + DAY),
    signingKey: signingKey as CryptoKey,
    publicKey: keys.publicKey as CryptoKey,
    signingAlgorithm: ALG,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.ExtendedKeyUsageExtension(['1.3.6.1.5.5.7.3.1']),
      new x509.SubjectAlternativeNameExtension([san]),
    ],
  });
  const der = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey));
  const key = `-----BEGIN PRIVATE KEY-----\n${der.toString('base64')}\n-----END PRIVATE KEY-----\n`;
  return { cert: cert.toString('pem'), key };
}

// A real TLS handshake that trusts only the root; host name checks are off so only the chain counts.
async function handshake(rootCert: string, leaf: { cert: string; key: string }): Promise<string> {
  const server = tls.createServer({ cert: leaf.cert, key: leaf.key }, (s) => s.end());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await new Promise<string>((resolve) => {
      const socket = tls.connect({
        host: '127.0.0.1',
        port,
        ca: rootCert,
        servername: 'shop.localhost',
        checkServerIdentity: () => undefined,
      });
      socket.once('secureConnect', () => {
        socket.destroy();
        resolve('ok');
      });
      socket.once('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? error.message));
    });
  } finally {
    server.close();
  }
}

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

  it('the root is accepted only for .localhost DNS names, never for IP addresses (TLS handshake)', async () => {
    const file = join(await dir(), 'ca.json');
    const ca = createLocalCa({ file, now: Date.now, logger: createMemoryLogger() });
    const { cert } = await ca.root();
    const saved = JSON.parse(await readFile(file, 'utf8')) as {
      root: { cert: string; key: string };
    };
    const ext = new x509.X509Certificate(cert).extensions.find((e) => e.type === '2.5.29.30');
    const nc = AsnConvert.parse(ext?.value ?? new ArrayBuffer(0), NameConstraints);
    // 0.0.0.0/0 and ::/0: an all-zero address and mask, 8 and 32 bytes.
    expect(nc.excludedSubtrees?.map((t) => t.base.iPAddress)).toEqual(['0.0.0.0/0', '::/0']);
    expect(await handshake(cert, await ca.leaf('shop.localhost'))).toBe('ok');
    const dns = await forgeLeaf(saved.root, { type: 'dns', value: 'example.com' });
    expect(await handshake(cert, dns)).not.toBe('ok');
    const ipv4 = await forgeLeaf(saved.root, { type: 'ip', value: '1.2.3.4' });
    expect(await handshake(cert, ipv4)).not.toBe('ok');
    const ipv6 = await forgeLeaf(saved.root, { type: 'ip', value: '2001:db8::1' });
    expect(await handshake(cert, ipv6)).not.toBe('ok');
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

  it('reset() beats work in flight, even when the old file is on disk', async () => {
    for (let i = 0; i < 20; i += 1) {
      const file = join(await dir(), 'ca.json');
      const logger = createMemoryLogger();
      const old = await createLocalCa({ file, now: Date.now, logger }).root();
      const ca = createLocalCa({ file, now: Date.now, logger });
      const first = ca.root();
      await ca.reset();
      const second = await ca.root();
      await first.catch(() => undefined);
      expect(second.sha1).not.toBe(old.sha1);
      expect(ca.regenerated()).toBe(true);
      expect((await ca.root()).sha1).toBe(second.sha1);
      const saved = JSON.parse(await readFile(file, 'utf8')) as { root: { sha1: string } };
      expect(saved.root.sha1).toBe(second.sha1);
    }
  });
});
