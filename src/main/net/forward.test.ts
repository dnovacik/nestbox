import { describe, expect, it } from 'vitest';
import { hostName, isLocalHost, proxyRequestHeaders } from './forward';

const pairs = (raw: string[]) => {
  const out: [string, string][] = [];
  for (let i = 0; i < raw.length; i += 2) out.push([raw[i] ?? '', raw[i + 1] ?? '']);
  return out;
};

describe('hostName / isLocalHost', () => {
  it('drops the port and lowercases', () => {
    expect(hostName('Shop.Localhost:443')).toBe('shop.localhost');
    expect(hostName('[::1]:4020')).toBe('[::1]');
    expect(isLocalHost('localhost:3000')).toBe(true);
    expect(isLocalHost('shop.localhost')).toBe(false);
  });
});

describe('proxyRequestHeaders', () => {
  const raw = [
    'Host',
    'shop.localhost',
    'Connection',
    'keep-alive',
    'Cookie',
    'a=1',
    'Cookie',
    'b=2',
    'X-Forwarded-For',
    '10.0.0.9',
    'Upgrade',
    'websocket',
  ];

  it('keeps Host, drops hop-by-hop headers and adds X-Forwarded-*', () => {
    const out = pairs(
      proxyRequestHeaders(raw, {
        host: 'shop.localhost',
        proto: 'https',
        remoteAddress: '127.0.0.1',
        rewriteHostTo: null,
      }),
    );
    expect(out).toEqual([
      ['Host', 'shop.localhost'],
      ['Cookie', 'a=1'],
      ['Cookie', 'b=2'],
      ['X-Forwarded-Host', 'shop.localhost'],
      ['X-Forwarded-Proto', 'https'],
      ['X-Forwarded-For', '10.0.0.9, 127.0.0.1'],
    ]);
  });

  it('rewrites Host when asked, keeping X-Forwarded-Host as the name', () => {
    const out = pairs(
      proxyRequestHeaders(raw, {
        host: 'shop.localhost',
        proto: 'http',
        remoteAddress: undefined,
        rewriteHostTo: 'localhost:3000',
      }),
    );
    expect(out[0]).toEqual(['Host', 'localhost:3000']);
    expect(out).toContainEqual(['X-Forwarded-Host', 'shop.localhost']);
    expect(out).toContainEqual(['X-Forwarded-For', '10.0.0.9']);
  });
});
