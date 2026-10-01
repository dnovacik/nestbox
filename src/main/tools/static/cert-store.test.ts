import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCertStore, type GenerateCert } from './cert-store';

const DAY = 86_400_000;
let dir = '';
let now = Date.UTC(2026, 9, 1);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nestbox-cert-'));
  now = Date.UTC(2026, 9, 1);
});
afterEach(async () => rm(dir, { recursive: true, force: true }));

function setup() {
  let n = 0;
  const generate: GenerateCert = vi.fn(async (ips: readonly string[], validUntil: number) => ({
    cert: `CERT-${++n}-${ips.join(',')}`,
    key: `KEY-${n}`,
    validUntil,
  }));
  const store = createCertStore({ file: join(dir, 'static-cert.json'), generate, now: () => now });
  return { store, generate };
}

describe('certificate store', () => {
  it('generates once for localhost and the LAN IPs and reuses it', async () => {
    const { store, generate } = setup();
    const first = await store.get(['192.168.1.20']);
    expect(first).toEqual({ cert: 'CERT-1-192.168.1.20', key: 'KEY-1' });
    expect(generate).toHaveBeenCalledWith(['192.168.1.20'], now + 365 * DAY);
    expect(await store.get(['192.168.1.20'])).toEqual(first);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('survives a restart by reading the file', async () => {
    await setup().store.get(['10.0.0.5']);
    const again = setup();
    expect(await again.store.get(['10.0.0.5'])).toEqual({ cert: 'CERT-1-10.0.0.5', key: 'KEY-1' });
    expect(again.generate).not.toHaveBeenCalled();
  });

  it('regenerates when a LAN IP is not covered', async () => {
    const { store, generate } = setup();
    await store.get(['192.168.1.20']);
    expect((await store.get(['192.168.1.20', '10.0.0.5'])).cert).toBe('CERT-2-192.168.1.20,10.0.0.5');
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('regenerates within 30 days of expiry', async () => {
    const { store, generate } = setup();
    await store.get([]);
    now += 340 * DAY;
    await store.get([]);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('regenerates over a corrupt file', async () => {
    await writeFile(join(dir, 'static-cert.json'), '{nope');
    const { store, generate } = setup();
    await store.get([]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(join(dir, 'static-cert.json'), 'utf8'))).toMatchObject({ cert: 'CERT-1-' });
  });
});

describe('generateWithSelfsigned', () => {
  it('makes a certificate for localhost, 127.0.0.1 and the LAN IPs that Node accepts', async () => {
    const { X509Certificate, createPrivateKey } = await import('node:crypto');
    const { generateWithSelfsigned } = await import('./cert-store');
    const until = Date.now() + 365 * DAY;
    const { cert, key } = await generateWithSelfsigned(['192.168.1.20'], until);
    const x509 = new X509Certificate(cert);
    expect(x509.subjectAltName).toContain('DNS:localhost');
    expect(x509.subjectAltName).toContain('IP Address:127.0.0.1');
    expect(x509.subjectAltName).toContain('IP Address:192.168.1.20');
    expect(Math.abs(new Date(x509.validTo).getTime() - until)).toBeLessThan(DAY);
    expect(x509.checkPrivateKey(createPrivateKey(key))).toBe(true);
  }, 30_000);
});
