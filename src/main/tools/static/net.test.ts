import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { firstFreePort, lanAddresses } from './net';

const open: Server[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

async function occupy(): Promise<number> {
  const server = createServer();
  open.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return address.port;
}

describe('firstFreePort', () => {
  it('returns the start port when it is free', async () => {
    const busy = await occupy();
    await new Promise<void>((r) => open.pop()?.close(() => r()));
    expect(await firstFreePort(busy, '127.0.0.1')).toBe(busy);
  });

  it('skips a busy port', async () => {
    const busy = await occupy();
    const port = await firstFreePort(busy, '127.0.0.1');
    expect(port).toBeGreaterThan(busy);
  });
});

describe('lanAddresses', () => {
  it('keeps external IPv4 addresses only, without link-local ones', () => {
    expect(
      lanAddresses({
        lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
        eth0: [
          { address: '192.168.1.20', family: 'IPv4', internal: false },
          { address: 'fe80::1', family: 'IPv6', internal: false },
        ],
        wifi: [
          { address: '169.254.10.1', family: 'IPv4', internal: false },
          { address: '10.0.0.5', family: 'IPv4', internal: false },
        ],
      }),
    ).toEqual(['192.168.1.20', '10.0.0.5']);
  });
});
