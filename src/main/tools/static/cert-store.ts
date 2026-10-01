import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';

const DAY = 86_400_000;
const VALID_DAYS = 365;
/** Regenerate when the certificate would expire within this many days. */
const RENEW_DAYS = 30;

const StoredSchema = z.object({
  cert: z.string().min(1),
  key: z.string().min(1),
  /** The LAN IPv4 addresses in the SAN (localhost and 127.0.0.1 always are). */
  ips: z.array(z.string()),
  validUntil: z.number(),
});

/** Generates a self-signed certificate for localhost, 127.0.0.1 and ips, valid until validUntil. */
export type GenerateCert = (ips: readonly string[], validUntil: number) => Promise<{ cert: string; key: string; validUntil: number }>;

export interface CertStore {
  /** A certificate covering ips, reused from disk when it still does and has 30+ days left. */
  get(ips: readonly string[]): Promise<{ cert: string; key: string }>;
}

/**
 * One self-signed certificate per machine, kept in userData so a phone only accepts it once. The PEM
 * text never leaves this module except to the HTTPS server, and is never logged.
 */
export function createCertStore(deps: { file: string; generate: GenerateCert; now(): number }): CertStore {
  let cached: z.infer<typeof StoredSchema> | null = null;

  async function load(): Promise<z.infer<typeof StoredSchema> | null> {
    if (cached) return cached;
    try {
      const parsed = StoredSchema.safeParse(JSON.parse(await readFile(deps.file, 'utf8')));
      cached = parsed.success ? parsed.data : null;
    } catch {
      cached = null;
    }
    return cached;
  }

  return {
    async get(ips) {
      const stored = await load();
      const fresh =
        stored !== null &&
        ips.every((ip) => stored.ips.includes(ip)) &&
        stored.validUntil - deps.now() > RENEW_DAYS * DAY;
      if (fresh) return { cert: stored.cert, key: stored.key };

      const generated = await deps.generate([...ips], deps.now() + VALID_DAYS * DAY);
      const next = { cert: generated.cert, key: generated.key, ips: [...ips], validUntil: generated.validUntil };
      const temp = join(dirname(deps.file), `.static-cert-${randomUUID()}.tmp`);
      try {
        await writeFile(temp, JSON.stringify(next), 'utf8');
        await rename(temp, deps.file);
      } catch {
        // Not kept: the next start generates again, which only costs the user one more warning.
        await rm(temp, { force: true }).catch(() => undefined);
      }
      cached = next;
      return { cert: next.cert, key: next.key };
    },
  };
}

/** The real generator: selfsigned (RSA 2048, SHA-256) with SANs for localhost, 127.0.0.1 and ips. */
export const generateWithSelfsigned: GenerateCert = async (ips, validUntil) => {
  const { generate } = await import('selfsigned');
  const pems = await generate([{ name: 'commonName', value: 'NestBox local server' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notAfterDate: new Date(validUntil),
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...ips.map((ip) => ({ type: 7 as const, ip }))],
      },
    ],
  });
  return { cert: pems.cert, key: pems.private, validUntil };
};
