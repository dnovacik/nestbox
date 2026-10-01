import { describe, expect, it } from 'vitest';
import { parseStructured, structuredOf } from './structured';

describe('parseStructured', () => {
  it('parses pino lines', () => {
    expect(
      parseStructured('{"level":30,"time":1727780000000,"pid":1,"hostname":"h","reqId":"req-1","context":"Http","msg":"GET /"}'),
    ).toMatchObject({ level: 'info', time: 1727780000000, context: 'Http', message: 'GET /', requestId: 'req-1' });
  });

  it.each([
    [10, 'trace'],
    [20, 'debug'],
    [40, 'warn'],
    [50, 'error'],
    [60, 'fatal'],
  ])('maps pino level %i to %s', (n, level) => {
    expect(parseStructured(`{"level":${n},"msg":"x"}`)?.level).toBe(level);
  });

  it('reads req.id when reqId is absent', () => {
    expect(parseStructured('{"level":30,"req":{"id":7},"msg":"x"}')?.requestId).toBe('7');
  });

  it('parses the NestJS JSON logger', () => {
    expect(
      parseStructured(
        '{"level":"log","pid":1,"timestamp":1727780000000,"message":"Nest application successfully started","context":"NestApplication"}',
      ),
    ).toMatchObject({ level: 'info', context: 'NestApplication', message: 'Nest application successfully started', time: 1727780000000 });
    expect(parseStructured('{"level":"verbose","message":"x"}')?.level).toBe('trace');
    expect(parseStructured('{"level":"log","message":{"a":1}}')?.message).toBe('{"a":1}');
    expect(parseStructured('{"level":"log","message":"x","timestamp":"2026-10-01T10:00:00.000Z"}')?.time).toBe(
      Date.parse('2026-10-01T10:00:00.000Z'),
    );
  });

  it('parses winston-style lines', () => {
    expect(parseStructured('{"level":"warn","message":"x"}')?.level).toBe('warn');
  });

  it.each(['plain text', '{ not json }', '[1,2]', '{"a":1}', '{"level":"loud"}', '{"level":"constructor"}'])(
    'returns null for %s',
    (text) => {
      expect(parseStructured(text)).toBeNull();
    },
  );

  it('ignores ANSI around the JSON', () => {
    expect(parseStructured('\u001b[32m{"level":30,"msg":"x"}\u001b[39m')?.message).toBe('x');
  });
});

describe('structuredOf', () => {
  it('caches per line and skips system lines', () => {
    const line = { seq: 1, ts: 1, stream: 'stdout' as const, text: '{"level":30,"msg":"x"}' };
    expect(structuredOf(line)).toBe(structuredOf(line));
    expect(structuredOf({ ...line, stream: 'system' })).toBeNull();
  });
});
