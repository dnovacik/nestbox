import { describe, expect, it } from 'vitest';
import { contentHash, parseTeamFile } from './parse';

const FILE = `{
  // the team's setup
  "version": 1,
  "commands": [{ "package": "", "name": "api", "argv": ["dotnet", "watch"] },],
  "main": { "": "dev" },
  "runGroups": [{ "name": "Full stack", "entries": [{ "package": "", "script": "dev" }], "compose": [{ "package": "", "services": ["db"] }] }],
  "health": { "packages/api": { "intervalSec": 30, "checks": [{ "id": "up", "kind": "env", "key": "API_URL", "path": "/health" }] } },
  "mock": { "": { "routes": [{ "id": "users", "method": "GET", "path": "/api/users", "body": "[]" }] } },
  "domains": { "names": { "": "shop" }, "rewriteHost": { "packages/web": true } },
  "envFiles": [{ "package": "", "name": "api", "file": ".env.local" }],
  "hidden": { "": ["ci"] }
}`;

describe('parseTeamFile', () => {
  it("reads every section into the tools' shapes (package → relPath), with defaults applied", () => {
    const r = parseTeamFile(FILE);
    if (!r.ok) throw new Error(r.error);
    expect(r.warnings).toEqual([]);
    expect(r.content.commands).toEqual([{ relPath: '', name: 'api', argv: ['dotnet', 'watch'] }]);
    expect(r.content.runGroups[0]).toEqual({
      name: 'Full stack',
      entries: [{ relPath: '', script: 'dev' }],
      compose: [{ relPath: '', services: ['db'] }],
    });
    expect(r.content.health['packages/api']).toEqual({
      intervalSec: 30,
      checks: [{ id: 'up', kind: 'env', key: 'API_URL', path: '/health' }],
    });
    expect(r.content.mock['']?.routes[0]).toMatchObject({
      id: 'users',
      method: 'GET',
      status: 200,
      enabled: true,
    });
    expect(r.content.domainNames).toEqual({ '': 'shop' });
    expect(r.content.rewriteHost).toEqual({ 'packages/web': true });
    expect(r.content.envFiles).toEqual([{ relPath: '', script: 'api', file: '.env.local' }]);
    expect(r.content.hidden).toEqual({ '': ['ci'] });
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps the hash across comment and whitespace edits, and changes it for an item edit', () => {
    const a = parseTeamFile(FILE);
    const b = parseTeamFile(
      FILE.replace("// the team's setup", '/* edited */').replace(/\n {2}/g, '\n    '),
    );
    const c = parseTeamFile(FILE.replace('"dotnet", "watch"', '"dotnet", "run"'));
    if (!a.ok || !b.ok || !c.ok) throw new Error('parse');
    expect(b.hash).toBe(a.hash);
    expect(c.hash).not.toBe(a.hash);
  });

  it('drops an invalid section with a warning naming it, keeping the rest', () => {
    const r = parseTeamFile(
      '{ "version": 1, "commands": [{ "package": "", "name": "x", "argv": ["a\\"b"] }], "main": { "": "dev" } }',
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.content.commands).toEqual([]);
    expect(r.content.main).toEqual({ '': 'dev' });
    expect(r.warnings).toEqual([{ section: 'commands', index: 0, reason: expect.any(String) }]);
    expect(JSON.stringify(r.warnings)).not.toContain('a\\"b');
  });

  it('refuses bad package paths, unknown keys get a warning, caps apply', () => {
    const r = parseTeamFile(
      JSON.stringify({
        version: 1,
        main: { '../x': 'dev' },
        extra: 1,
        commands: Array.from({ length: 101 }, (_, i) => ({
          package: '',
          name: `c${i}`,
          argv: ['x'],
        })),
      }),
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.content.main).toEqual({});
    expect(r.content.commands).toEqual([]);
    expect(r.warnings.map((w) => w.section).sort()).toEqual(['commands', 'extra', 'main']);
  });

  it('drops a run group whose entry or compose package is not a package path', () => {
    const entry = parseTeamFile(
      '{ "version": 1, "runGroups": [{ "name": "g", "entries": [{ "package": "../x", "script": "dev" }] }] }',
    );
    const compose = parseTeamFile(
      '{ "version": 1, "runGroups": [{ "name": "g", "entries": [], "compose": [{ "package": "a#b", "services": ["db"] }] }] }',
    );
    for (const r of [entry, compose]) {
      if (!r.ok) throw new Error(r.error);
      expect(r.content.runGroups).toEqual([]);
      expect(r.warnings).toEqual([{ section: 'runGroups', index: 0, reason: expect.any(String) }]);
      expect(JSON.stringify(r.warnings)).not.toContain('../x');
    }
  });

  it('drops env files and commands with a bad package, and bad keys in record sections', () => {
    const r = parseTeamFile(
      JSON.stringify({
        version: 1,
        envFiles: [{ package: '/abs', name: 'a', file: null }],
        commands: [{ package: 'a\\b', name: 'c', argv: ['x'] }],
        hidden: { '../x': ['ci'] },
        health: { '../x': { checks: [] } },
        mock: { '../x': { routes: [] } },
        domains: { names: { '../x': 'shop' }, rewriteHost: { 'a#b': true } },
      }),
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.content).toEqual({
      commands: [],
      main: {},
      envFiles: [],
      hidden: {},
      runGroups: [],
      health: {},
      mock: {},
      domainNames: {},
      rewriteHost: {},
    });
    expect(r.warnings.map((w) => w.section).sort()).toEqual([
      'commands',
      'domains.names',
      'domains.rewriteHost',
      'envFiles',
      'health',
      'hidden',
      'mock',
    ]);
  });

  it('is invalid for non-JSONC, a non-object root, an unknown version, or too much text', () => {
    expect(parseTeamFile('{ "version": 1, ')).toEqual({
      ok: false,
      error: expect.stringMatching(/^Line \d+, column \d+/),
    });
    expect(parseTeamFile('[1]')).toEqual({ ok: false, error: 'The file is not a JSON object' });
    expect(parseTeamFile('{ "version": 2 }')).toEqual({
      ok: false,
      error: 'Made by a newer NestBox (version 2)',
    });
    expect(parseTeamFile(' '.repeat(256 * 1024 + 1))).toEqual({
      ok: false,
      error: 'The file is larger than 256 KiB',
    });
  });

  it('hashes canonical content, independent of key order', () => {
    const r1 = parseTeamFile('{ "version": 1, "main": { "a": "x", "b": "y" } }');
    const r2 = parseTeamFile('{ "main": { "b": "y", "a": "x" }, "version": 1 }');
    if (!r1.ok || !r2.ok) throw new Error('parse');
    expect(contentHash(r1.content)).toBe(contentHash(r2.content));
  });
});

describe('parseTeamFile on hostile input', () => {
  it('never throws on deeply nested input', () => {
    const msg = { ok: false, error: 'The file is nested too deeply' };
    expect(parseTeamFile('['.repeat(100000))).toEqual(msg);
    expect(parseTeamFile('['.repeat(10000) + ']'.repeat(10000))).toEqual(msg);
    expect(parseTeamFile('{"a":"[[[[' + '[ '.repeat(10) + '", // [[[[\n "version": 1 }').ok).toBe(
      true,
    );
    expect(parseTeamFile(FILE).ok).toBe(true);
  });

  it('truncates unknown keys and caps their warnings', () => {
    const obj: Record<string, number> = { version: 1 };
    for (let i = 0; i < 15; i++) obj[`k${i}`] = 1;
    const r = parseTeamFile(JSON.stringify(obj));
    if (!r.ok) throw new Error(r.error);
    expect(r.warnings).toHaveLength(11);
    expect(r.warnings.at(-1)).toEqual({
      section: 'unknown',
      index: null,
      reason: '5 more unknown sections',
    });
    const long = parseTeamFile(JSON.stringify({ version: 1, ['x'.repeat(100)]: 1 }));
    if (!long.ok) throw new Error(long.error);
    expect(long.warnings[0]?.section).toBe(`${'x'.repeat(40)}…`);
  });

  it('does not take version or sections from __proto__', () => {
    expect(parseTeamFile('{"__proto__":{"version":1}}')).toEqual({
      ok: false,
      error: 'Made by a newer NestBox (version undefined)',
    });
    const r = parseTeamFile('{"version":1,"__proto__":{"main":{"":"dev"}}}');
    if (!r.ok) throw new Error(r.error);
    expect(r.content.main).toEqual({});
  });
});
