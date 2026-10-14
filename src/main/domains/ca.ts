// NestBox's local certificate authority for local domains. The root is name-constrained to .localhost (a
// critical extension), so even a leaked key can't make a certificate a browser accepts for a real site.
// Leaves are made per host name on demand. Certificates and keys never leave this module except to the
// TLS server, and are never logged.
import { createHash, randomBytes, randomUUID, webcrypto } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { AsnConvert } from '@peculiar/asn1-schema';
import { GeneralName, GeneralSubtree, GeneralSubtrees, NameConstraints } from '@peculiar/asn1-x509';
import * as x509 from '@peculiar/x509';
import { z } from 'zod';
import type { Logger } from '../logger';

export const NAME_CONSTRAINTS_OID = '2.5.29.30';
const DAY = 86_400_000;
const ROOT_DAYS = 3650;
const LEAF_DAYS = 365;
const RENEW_DAYS = 30;
const ALG = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 2048,
} as const;
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+localhost$/;

x509.cryptoProvider.set(webcrypto as never);

const PairSchema = z.object({ cert: z.string().min(1), key: z.string().min(1) });
const FileSchema = z.object({
  root: PairSchema.extend({ sha1: z.string(), serialHex: z.string() }),
  leaves: z.record(z.string(), PairSchema.extend({ validUntil: z.number() })),
});
type CaFile = z.infer<typeof FileSchema>;

export interface LocalCa {
  root(): Promise<{ cert: string; sha1: string; serialHex: string }>;
  leaf(host: string): Promise<{ cert: string; key: string }>;
  /** Deletes the CA (a new root is made on next use). */
  reset(): Promise<void>;
  /**
   * True when this object made a new root (first run, a missing or corrupt file, or after reset()).
   * The service sets trust back to none in each case.
   */
  regenerated(): boolean;
}

const serial = () =>
  randomBytes(16)
    .toString('hex')
    .replace(/^[89a-f]/, '1');

async function keyPem(key: webcrypto.CryptoKey): Promise<string> {
  const der = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', key));
  return `-----BEGIN PRIVATE KEY-----\n${der
    .toString('base64')
    .match(/.{1,64}/g)
    ?.join('\n')}\n-----END PRIVATE KEY-----\n`;
}

async function importKey(pem: string): Promise<webcrypto.CryptoKey> {
  const der = Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ''), 'base64');
  return webcrypto.subtle.importKey('pkcs8', der, ALG, false, [
    'sign',
  ]) as unknown as Promise<webcrypto.CryptoKey>;
}

async function makeRoot(now: number): Promise<CaFile['root']> {
  const keys = (await webcrypto.subtle.generateKey(ALG, true, [
    'sign',
    'verify',
  ])) as webcrypto.CryptoKeyPair;
  const constraints = new NameConstraints({
    permittedSubtrees: new GeneralSubtrees([
      new GeneralSubtree({ base: new GeneralName({ dNSName: 'localhost' }) }),
    ]),
    // IP address SANs aren't covered by a dNSName subtree (RFC 5280), so every IPv4 and IPv6 address is
    // excluded: address and mask all zeros (8 and 32 bytes).
    excludedSubtrees: new GeneralSubtrees([
      new GeneralSubtree({ base: new GeneralName({ iPAddress: '0.0.0.0/0' }) }),
      new GeneralSubtree({ base: new GeneralName({ iPAddress: '::/0' }) }),
    ]),
  });
  const serialHex = serial();
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: serialHex,
    name: 'CN=NestBox Local CA, O=NestBox',
    notBefore: new Date(now - DAY),
    notAfter: new Date(now + ROOT_DAYS * DAY),
    keys,
    signingAlgorithm: ALG,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
        true,
      ),
      new x509.Extension(NAME_CONSTRAINTS_OID, true, AsnConvert.serialize(constraints)),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
    ],
  });
  const pem = cert.toString('pem');
  return {
    cert: pem,
    key: await keyPem(keys.privateKey),
    sha1: createHash('sha1').update(Buffer.from(cert.rawData)).digest('hex'),
    serialHex: cert.serialNumber.toLowerCase(),
  };
}

async function makeLeaf(
  root: CaFile['root'],
  host: string,
  now: number,
): Promise<CaFile['leaves'][string]> {
  const keys = (await webcrypto.subtle.generateKey(ALG, true, [
    'sign',
    'verify',
  ])) as webcrypto.CryptoKeyPair;
  const issuer = new x509.X509Certificate(root.cert);
  const validUntil = now + LEAF_DAYS * DAY;
  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: serial(),
    subject: `CN=${host}`,
    issuer: issuer.subject,
    notBefore: new Date(now - DAY),
    notAfter: new Date(validUntil),
    signingKey: await importKey(root.key),
    publicKey: keys.publicKey,
    signingAlgorithm: ALG,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment,
        true,
      ),
      new x509.ExtendedKeyUsageExtension(['1.3.6.1.5.5.7.3.1']),
      new x509.SubjectAlternativeNameExtension([{ type: 'dns', value: host }]),
      await x509.AuthorityKeyIdentifierExtension.create(issuer),
    ],
  });
  return { cert: cert.toString('pem'), key: await keyPem(keys.privateKey), validUntil };
}

export function createLocalCa(deps: { file: string; now(): number; logger: Logger }): LocalCa {
  let state: CaFile | null = null;
  let fresh = false;
  let pending: Promise<CaFile | null> | null = null;
  // Bumped by reset(): work started in an older generation must not touch state or the file.
  let gen = 0;
  // Set by reset(): the file on disk is no longer ours to read until a new root exists.
  let discardFile = false;
  const inflight = new Map<string, Promise<{ cert: string; key: string }>>();
  // Every write goes through this chain, so writes never overlap and the last carries the full map.
  let chain: Promise<void> = Promise.resolve();

  function persist(g: number): Promise<void> {
    const run = chain.then(async () => {
      if (g !== gen || !state) return;
      const tmp = `${deps.file}.${randomUUID()}.tmp`;
      try {
        await writeFile(tmp, JSON.stringify(state), { mode: 0o600 });
        await rename(tmp, deps.file);
      } catch (error) {
        await rm(tmp, { force: true }).catch(() => undefined);
        throw error;
      }
    });
    chain = run.catch(() => undefined);
    return run;
  }

  async function load(): Promise<CaFile> {
    for (;;) {
      if (state) return state;
      const g = gen;
      if (!pending) {
        const mine: Promise<CaFile | null> = (async () => {
          let data: CaFile;
          let created = false;
          try {
            if (discardFile) throw new Error('reset');
            data = FileSchema.parse(JSON.parse(await readFile(deps.file, 'utf8')));
            new x509.X509Certificate(data.root.cert); // throws on a damaged PEM
          } catch {
            created = true;
            data = { root: await makeRoot(deps.now()), leaves: {} };
          }
          if (g !== gen) return null;
          state = data;
          discardFile = false;
          if (created) {
            fresh = true;
            await persist(g);
            if (g !== gen) return null;
            deps.logger.info('domains ca created');
          }
          return data;
        })().finally(() => {
          if (pending === mine) pending = null;
        });
        pending = mine;
      }
      const result = await pending;
      if (result) return result;
    }
  }

  async function makeLeafFor(name: string): Promise<{ cert: string; key: string }> {
    for (;;) {
      const g = gen;
      const data = await load();
      const cached = data.leaves[name];
      if (cached && cached.validUntil - deps.now() > RENEW_DAYS * DAY)
        return { cert: cached.cert, key: cached.key };
      const made = await makeLeaf(data.root, name, deps.now());
      if (g !== gen) continue;
      data.leaves[name] = made;
      await persist(g);
      if (g !== gen) continue;
      return { cert: made.cert, key: made.key };
    }
  }

  return {
    async root() {
      const { root } = await load();
      return { cert: root.cert, sha1: root.sha1, serialHex: root.serialHex };
    },
    leaf(host) {
      const name = host.toLowerCase();
      if (!HOST.test(name)) return Promise.reject(new Error('not a .localhost name'));
      const existing = inflight.get(name);
      if (existing) return existing;
      const p = makeLeafFor(name).finally(() => {
        if (inflight.get(name) === p) inflight.delete(name);
      });
      inflight.set(name, p);
      return p;
    },
    async reset() {
      gen += 1;
      state = null;
      fresh = false;
      pending = null;
      inflight.clear();
      discardFile = true;
      // On the write chain, so no earlier write lands after it and no later one is deleted by it.
      const removed = chain.then(() => rm(deps.file, { force: true }));
      chain = removed.catch(() => undefined);
      await removed;
    },
    regenerated: () => fresh,
  };
}
