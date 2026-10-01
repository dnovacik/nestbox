import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';

/** The first port from start (up to start + 50) that host can bind; null when none can. */
export async function firstFreePort(start: number, host: string): Promise<number | null> {
  for (let port = start; port <= Math.min(start + 50, 65_535); port++) {
    if (await canBind(port, host)) return port;
  }
  return null;
}

function canBind(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
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
