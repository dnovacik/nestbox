import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { groupSockets, parseNetstat, parseTasklist } from './win32-ports';

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

describe('parseNetstat', () => {
  it('keeps listening IPv4 rows (whatever the localised state word) and drops connections', () => {
    expect(parseNetstat(fixture('netstat-tcp.txt'))).toEqual([
      { port: 135, address: '0.0.0.0', pid: 1032 },
      { port: 3000, address: '0.0.0.0', pid: 8108 },
      { port: 5000, address: '0.0.0.0', pid: 7000 },
      { port: 5000, address: '127.0.0.1', pid: 7100 },
      { port: 6379, address: '127.0.0.1', pid: 4420 },
      { port: 8080, address: '0.0.0.0', pid: 2222 },
    ]);
  });

  it('reads bracketed IPv6 addresses, including a zone id', () => {
    expect(parseNetstat(fixture('netstat-tcpv6.txt'))).toEqual([
      { port: 135, address: '::', pid: 1032 },
      { port: 3000, address: '::', pid: 8108 },
      { port: 5432, address: '::1', pid: 5120 },
      { port: 5353, address: 'fe80::1%12', pid: 7000 },
    ]);
  });

  it('ignores headers, blank lines and malformed rows', () => {
    expect(parseNetstat('garbage\n  TCP    nonsense\n  UDP    0.0.0.0:53   *:*   1\n')).toEqual([]);
  });
});

describe('parseTasklist', () => {
  it('maps PIDs to image names, with commas inside quotes', () => {
    const names = parseTasklist(fixture('tasklist.csv'));
    expect(names.get(8108)).toBe('node.exe');
    expect(names.get(7000)).toBe('Code Helper, Inc.exe');
    expect(names.get(4)).toBe('System');
    expect(names.size).toBe(5);
  });

  it('ignores lines that are not CSV rows', () => {
    expect(parseTasklist('INFO: No tasks are running which match the specified criteria.\r\n').size).toBe(0);
  });
});

describe('groupSockets', () => {
  it('merges the IPv4 and IPv6 sockets of one PID on one port, sorted by port then PID', () => {
    const sockets = [...parseNetstat(fixture('netstat-tcp.txt')), ...parseNetstat(fixture('netstat-tcpv6.txt'))];
    expect(groupSockets(sockets)).toEqual([
      { port: 135, pid: 1032, addresses: ['0.0.0.0', '::'] },
      { port: 3000, pid: 8108, addresses: ['0.0.0.0', '::'] },
      { port: 5000, pid: 7000, addresses: ['0.0.0.0'] },
      { port: 5000, pid: 7100, addresses: ['127.0.0.1'] },
      { port: 5353, pid: 7000, addresses: ['fe80::1%12'] },
      { port: 5432, pid: 5120, addresses: ['::1'] },
      { port: 6379, pid: 4420, addresses: ['127.0.0.1'] },
      { port: 8080, pid: 2222, addresses: ['0.0.0.0'] },
    ]);
  });
});
