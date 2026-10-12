import { describe, expect, it } from 'vitest';
import {
  addConfigKey,
  caseDuplicates,
  configColumnRank,
  findLeaf,
  leafValue,
  parseConfig,
  removeConfigKey,
  setConfigValue,
  toJsonValue,
} from './appsettings';

const WEBAPI = `{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "AllowedHosts": "*"
}
`;

const COMMENTED = `{
  // The database
  "ConnectionStrings": {
    "Default": "Server=db;Password=s3cret", /* inline */
  },
  "Retries": 3,
  "AllowedOrigins": ["https://a.test", "https://b.test"],
  "Features": {},
  "Empty": "",
  "Nothing": null,
  "Flag": true,
}
`;

const keys = (text: string) => parseConfig(text)?.map((l) => l.key);

describe('parseConfig', () => {
  it('flattens objects with ":" and arrays by index', () => {
    expect(keys(WEBAPI)).toEqual(['Logging:LogLevel:Default', 'Logging:LogLevel:Microsoft.AspNetCore', 'AllowedHosts']);
    expect(keys(COMMENTED)).toEqual([
      'ConnectionStrings:Default',
      'Retries',
      'AllowedOrigins:0',
      'AllowedOrigins:1',
      'Features',
      'Empty',
      'Nothing',
      'Flag',
    ]);
  });

  it('types leaves and marks empty ones ("", null, {} and [])', () => {
    const leaves = parseConfig(COMMENTED) ?? [];
    const byKey = Object.fromEntries(leaves.map((l) => [l.key, [l.type, l.empty]]));
    expect(byKey).toMatchObject({
      'ConnectionStrings:Default': ['string', false],
      Retries: ['number', false],
      Features: ['object', true],
      Empty: ['string', true],
      Nothing: ['null', true],
      Flag: ['boolean', false],
    });
    expect(parseConfig('{"List": []}')?.[0]).toMatchObject({ key: 'List', type: 'array', empty: true });
  });

  it('is null for syntax errors and roots that are not objects', () => {
    expect(parseConfig('{ "A": ')).toBeNull();
    expect(parseConfig('[1, 2]')).toBeNull();
    expect(parseConfig('')).toBeNull();
    expect(parseConfig('﻿{"A": 1}')).toHaveLength(1);
  });

  it('finds keys case-insensitively (the last one wins) and reports case duplicates', () => {
    const leaves = parseConfig('{"Port": 1, "port": 2, "Name": "x"}') ?? [];
    expect(findLeaf(leaves, 'PORT')?.path).toEqual(['port']);
    expect(caseDuplicates(leaves)).toEqual(['Port']);
    expect(caseDuplicates(parseConfig(WEBAPI) ?? [])).toEqual([]);
  });

  it('shows strings as they are and other values as their JSON text', () => {
    const leaves = parseConfig('{"S": "a\\"b", "N": 1.50, "B": false, "Z": null, "O": {}}') ?? [];
    const value = (key: string) => leafValue('{"S": "a\\"b", "N": 1.50, "B": false, "Z": null, "O": {}}', findLeaf(leaves, key)!);
    expect([value('S'), value('N'), value('B'), value('Z'), value('O')]).toEqual(['a"b', '1.50', 'false', 'null', '{}']);
  });
});

describe('edits', () => {
  it('changes only the value: comments, trailing commas and the rest stay byte-identical', () => {
    const out = setConfigValue(COMMENTED, 'ConnectionStrings:Default', 'Server=other');
    expect(out).toBe(COMMENTED.replace('Server=db;Password=s3cret', 'Server=other'));
  });

  it('keeps CRLF and a BOM', () => {
    const text = '﻿' + WEBAPI.replace(/\n/g, '\r\n');
    const out = setConfigValue(text, 'AllowedHosts', 'localhost');
    expect(out).toBe(text.replace('"*"', '"localhost"'));
    const added = addConfigKey(text, 'Kestrel:Port', 5000);
    expect(added.startsWith('﻿{')).toBe(true);
    expect(added.replace(/\r\n/g, '')).not.toContain('\n');
    expect(findLeaf(parseConfig(added) ?? [], 'Kestrel:Port')).toBeDefined();
  });

  it('resolves the path case-insensitively and can change the type', () => {
    const out = setConfigValue(WEBAPI, 'logging:loglevel:default', 7);
    expect(out).toContain('"Default": 7');
    expect(keys(out)).toEqual(keys(WEBAPI));
  });

  it('adds keys at the end of their parent, creating missing parents', () => {
    const out = addConfigKey(WEBAPI, 'Logging:LogLevel:System', 'Error');
    expect(keys(out)).toEqual([...(keys(WEBAPI) ?? []).slice(0, 2), 'Logging:LogLevel:System', 'AllowedHosts']);
    const nested = addConfigKey(WEBAPI, 'Jwt:Issuer', 'me');
    expect(keys(nested)?.at(-1)).toBe('Jwt:Issuer');
    expect(nested).toMatch(/\n {2}"Jwt": \{\n {4}"Issuer": "me"\n {2}\}\n\}/);
  });

  it('appends to an array at its length and refuses an index past the end', () => {
    const out = addConfigKey(COMMENTED, 'AllowedOrigins:2', 'https://c.test');
    expect(findLeaf(parseConfig(out) ?? [], 'AllowedOrigins:2')).toBeDefined();
    expect(() => addConfigKey(COMMENTED, 'AllowedOrigins:5', 'x')).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
    expect(() => addConfigKey(COMMENTED, 'AllowedOrigins:x', 'x')).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
  });

  it('refuses a key that exists, a parent that is a value and a key that holds others', () => {
    expect(() => addConfigKey(WEBAPI, 'allowedhosts', 'x')).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
    expect(() => addConfigKey(WEBAPI, 'AllowedHosts:Inner', 'x')).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
    expect(() => addConfigKey(WEBAPI, 'Logging', 'x')).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
    // An empty object can take keys.
    expect(keys(addConfigKey(COMMENTED, 'Features:Beta', true))).toContain('Features:Beta');
  });

  it('refuses edits to a missing key and to an invalid file', () => {
    expect(() => setConfigValue(WEBAPI, 'Nope', 'x')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => removeConfigKey(WEBAPI, 'Nope')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => setConfigValue('{ "A": ', 'A', 'x')).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
  });

  it('removes a key and leaves {} after the last one', () => {
    const out = removeConfigKey(COMMENTED, 'Retries');
    expect(keys(out)).not.toContain('Retries');
    expect(out).toContain('// The database');
    expect(removeConfigKey('{\n  "A": 1\n}\n', 'a').replace(/\s/g, '')).toBe('{}');
  });

  it('writes into an empty file object with two-space indentation', () => {
    expect(addConfigKey('{}\n', 'Name', 'x')).toBe('{\n  "Name": "x"\n}\n');
    expect(addConfigKey('{\n\t"A": 1\n}', 'B', 2)).toBe('{\n\t"A": 1,\n\t"B": 2\n}');
  });
});

describe('toJsonValue', () => {
  it('converts typed input and refuses what is not that type', () => {
    expect(toJsonValue('hi', 'string')).toBe('hi');
    expect(toJsonValue(' 42 ', 'number')).toBe(42);
    expect(toJsonValue('-1.5e3', 'number')).toBe(-1500);
    expect(toJsonValue('true', 'boolean')).toBe(true);
    expect(toJsonValue('anything', 'null')).toBeNull();
    for (const bad of ['abc', '1e999', '01', '', 'NaN']) {
      expect(() => toJsonValue(bad, 'number')).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
    }
    expect(() => toJsonValue('yes', 'boolean')).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
  });
});

describe('configColumnRank', () => {
  it('orders the base file, the standard environments, then the rest', () => {
    const names = ['appsettings.Zeta.json', 'appsettings.Production.json', 'appsettings.json', 'appsettings.Alpha.json', 'appsettings.Development.json', 'appsettings.Staging.json'];
    const sorted = [...names].sort((a, b) => configColumnRank(a) - configColumnRank(b) || a.localeCompare(b));
    expect(sorted).toEqual([
      'appsettings.json',
      'appsettings.Development.json',
      'appsettings.Staging.json',
      'appsettings.Production.json',
      'appsettings.Alpha.json',
      'appsettings.Zeta.json',
    ]);
  });
});
