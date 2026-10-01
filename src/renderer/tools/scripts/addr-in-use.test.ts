import { describe, expect, it } from 'vitest';
import type { LogLine } from '@shared/processes';
import { addrInUsePort } from './addr-in-use';

let seq = 0;
const line = (text: string, stream: LogLine['stream'] = 'stderr'): LogLine => ({ seq: ++seq, ts: 0, stream, text });
const start = () => line('▸ pnpm run dev', 'system');

describe('addrInUsePort', () => {
  it.each([
    ['Error: listen EADDRINUSE: address already in use :::3000', 3000],
    ['Error: listen EADDRINUSE: address already in use 0.0.0.0:5173', 5173],
    ['Error: listen EADDRINUSE: address already in use 127.0.0.1:8080', 8080],
    ['\u001b[31mError: listen EADDRINUSE: address already in use [::1]:4200\u001b[39m', 4200],
    ['Error: Port 5173 is already in use', 5173],
    ["[Nest] 1234  - 01/10/2026 ERROR [NestApplication] Error: listen EADDRINUSE: address already in use :::3001 +2ms", 3001],
    ['{"level":50,"err":{"code":"EADDRINUSE","port":3002,"message":"listen EADDRINUSE"}}', 3002],
  ])('reads %j', (text, port) => {
    expect(addrInUsePort([start(), line(text)])).toBe(port);
  });

  it('only looks after the last start', () => {
    expect(addrInUsePort([start(), line('EADDRINUSE: address already in use :::3000'), start(), line('ready')])).toBeNull();
  });

  it('uses the last match after the start', () => {
    expect(addrInUsePort([start(), line('EADDRINUSE :::3000'), line('EADDRINUSE :::3001')])).toBe(3001);
  });

  it('works without any start line', () => {
    expect(addrInUsePort([line('EADDRINUSE: address already in use :::3000')])).toBe(3000);
  });

  it('returns null without a match or with an out-of-range port', () => {
    expect(addrInUsePort([start(), line('ready on 3000')])).toBeNull();
    expect(addrInUsePort([start(), line('EADDRINUSE :::99999')])).toBeNull();
  });
});
