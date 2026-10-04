import { describe, expect, it } from 'vitest';
import { mergeServices, parsePs, parseServices, servicePorts } from './parse';

const DB = {
  Command: '"docker-entrypoint.s…"',
  Labels: 'com.docker.compose.project=shop,secret=hunter2',
  Name: 'shop-db-1',
  Service: 'db',
  State: 'running',
  Health: 'healthy',
  ExitCode: 0,
  Publishers: [
    { URL: '0.0.0.0', TargetPort: 5432, PublishedPort: 5432, Protocol: 'tcp' },
    { URL: '::', TargetPort: 5432, PublishedPort: 5432, Protocol: 'tcp' },
    { URL: '', TargetPort: 9000, PublishedPort: 0, Protocol: 'tcp' },
  ],
};
const WEB = { Service: 'web', State: 'exited', Health: '', ExitCode: 137, Publishers: [] };

describe('parseServices', () => {
  it('reads one name per line and ignores blanks and odd names', () => {
    expect(parseServices('db\r\nweb\n\nbad name\n')).toEqual(['db', 'web']);
  });
});

describe('parsePs', () => {
  it('reads a JSON array (older Compose) and JSON lines (newer)', () => {
    const fromArray = parsePs(JSON.stringify([DB, WEB]));
    const fromLines = parsePs(`${JSON.stringify(DB)}\n${JSON.stringify(WEB)}\n`);
    expect(fromArray).toEqual(fromLines);
    expect(fromLines).toEqual([
      {
        service: 'db',
        state: 'running',
        health: 'healthy',
        exitCode: 0,
        ports: [{ published: 5432, target: 5432, protocol: 'tcp' }],
      },
      { service: 'web', state: 'exited', health: null, exitCode: 137, ports: [] },
    ]);
  });

  it('keeps nothing but those fields', () => {
    expect(JSON.stringify(parsePs(JSON.stringify([DB])))).not.toMatch(
      /hunter2|entrypoint|shop-db-1/,
    );
  });

  it('returns an empty list for empty output and skips lines that are not containers', () => {
    expect(parsePs('')).toEqual([]);
    expect(parsePs('[]')).toEqual([]);
    expect(parsePs(`not json\n${JSON.stringify(WEB)}\n{"Service":3}`)).toHaveLength(1);
  });

  it('maps unknown states and health to safe values', () => {
    expect(
      parsePs(JSON.stringify({ Service: 'x', State: 'weird', Health: 'odd', ExitCode: 'n' })),
    ).toEqual([{ service: 'x', state: 'dead', health: null, exitCode: null, ports: [] }]);
  });
});

describe('servicePorts', () => {
  it('drops unpublished ports and IPv4/IPv6 duplicates', () => {
    expect(servicePorts(DB.Publishers)).toEqual([
      { published: 5432, target: 5432, protocol: 'tcp' },
    ]);
    expect(servicePorts(undefined)).toEqual([]);
  });
});

describe('mergeServices', () => {
  it('lists every service in file order, one container each, and not-created for the rest', () => {
    const containers = parsePs(JSON.stringify([WEB, DB]));
    expect(mergeServices(['db', 'web', 'cache'], containers).map((s) => [s.name, s.state])).toEqual(
      [
        ['db', 'running'],
        ['web', 'exited'],
        ['cache', 'not-created'],
      ],
    );
  });

  it('prefers a running container when a service has several (scaled)', () => {
    const containers = parsePs(JSON.stringify([WEB, { ...WEB, State: 'running', ExitCode: 0 }]));
    expect(mergeServices(['web'], containers)[0]?.state).toBe('running');
  });
});
