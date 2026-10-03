import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLsof } from './darwin-ports';

const fixture = readFileSync(join(__dirname, '__fixtures__', 'lsof-listen.txt'), 'utf8');

describe('parseLsof', () => {
  it('reads listening sockets with their PID and address', () => {
    const { sockets } = parseLsof(fixture);
    expect(sockets).toEqual([
      { pid: 412, address: '::1', port: 5432 },
      { pid: 412, address: '127.0.0.1', port: 5432 },
      { pid: 18260, address: '::1', port: 5173 },
      { pid: 20140, address: '0.0.0.0', port: 3000 },
      { pid: 20140, address: '::', port: 3000 },
      { pid: 9932, address: '::', port: 8080 },
      { pid: 777, address: '127.0.0.1', port: 631 },
    ]);
  });

  it('reads the command name per PID, when lsof gave one', () => {
    const { names } = parseLsof(fixture);
    expect(names.get(412)).toBe('postgres');
    expect(names.get(20140)).toBe('node');
    expect(names.has(777)).toBe(false);
  });

  it('copes with empty output (nothing listens) and junk lines', () => {
    expect(parseLsof('')).toEqual({ sockets: [], names: new Map() });
    expect(parseLsof('garbage\nn*:80\np\np12\nnnot-an-endpoint\nn*:99999\n').sockets).toEqual([]);
  });
});
