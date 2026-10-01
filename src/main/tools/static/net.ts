import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';

/** The first port from start (up to start + 50) that is free (see isPortFree); null when none is. */
export async function firstFreePort(start: number, host: string): Promise<number | null> {
  for (let port = start; port <= Math.min(start + 50, 65_535); port++) {
    if (await isPortFree(port, host)) return port;
  }
  return null;
}

/**
 * Whether host can bind port and nothing listens on [::1]:port. The tab shows localhost URLs, and a
 * browser that resolves localhost to ::1 first (Windows does) would reach that other server instead.
 */
export async function isPortFree(port: number, host: string): Promise<boolean> {
  return (await bindResult(port, host)) === 'ok' && (await bindResult(port, '::1')) !== 'in-use';
}

/** 'unavailable': the address can't be bound at all (no IPv6), which says nothing about the port. */
function bindResult(port: number, host: string): Promise<'ok' | 'in-use' | 'unavailable'> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) =>
      resolve(error.code === 'EADDRINUSE' || error.code === 'EACCES' ? 'in-use' : 'unavailable'),
    );
    server.listen(port, host, () => server.close(() => resolve('ok')));
  });
}

interface Iface {
  address: string;
  family: string | number;
  internal: boolean;
}

/** The machine's LAN IPv4 addresses (not loopback, not link-local 169.254.x.x). */
export function lanAddresses(interfaces: Record<string, Iface[] | undefined> = networkInterfaces()): string[] {
  const out: string[] = [];
  for (const list of Object.values(interfaces)) {
    for (const i of list ?? []) {
      const v4 = i.family === 'IPv4' || i.family === 4;
      if (v4 && !i.internal && !i.address.startsWith('169.254.') && !out.includes(i.address)) out.push(i.address);
    }
  }
  return out;
}
