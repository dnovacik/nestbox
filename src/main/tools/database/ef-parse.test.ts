import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { efLine, mentionsRestore, parseMigrationList } from './ef-parse';

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');
const dataOf = (text: string) =>
  text
    .split(/\r?\n/)
    .map(efLine)
    .filter((l) => l.data)
    .map((l) => l.text);

describe('efLine', () => {
  it("strips EF's 9-character prefixes and leaves the app's logging alone", () => {
    expect(efLine('info:    Build started...')).toEqual({ data: false, text: 'Build started...' });
    expect(efLine('error:   The migration has already been applied')).toEqual({
      data: false,
      text: 'The migration has already been applied',
    });
    expect(efLine('verbose: Finding design-time services')).toEqual({
      data: false,
      text: 'Finding design-time services',
    });
    expect(efLine('data:      "id": "x",')).toEqual({ data: true, text: '  "id": "x",' });
    expect(efLine('data:')).toEqual({ data: true, text: '' });
    expect(efLine('info: Microsoft.EntityFrameworkCore.Database.Command[20101]')).toEqual({
      data: false,
      text: 'info: Microsoft.EntityFrameworkCore.Database.Command[20101]',
    });
  });
});

describe('parseMigrationList', () => {
  it('reads dotnet-ef 10 output with the app’s SQL logging in between', () => {
    expect(parseMigrationList(dataOf(fixture('ef10-list.txt')))).toEqual([
      { id: '20261012151146_Init', name: 'Init', applied: true },
      { id: '20261012151151_AddOrders', name: 'AddOrders', applied: false },
    ]);
  });

  it('keeps applied null when EF could not reach the database, and reads dotnet-ef 8', () => {
    expect(
      parseMigrationList(dataOf(fixture('ef10-list-no-db.txt')))?.map((m) => m.applied),
    ).toEqual([null, null]);
    expect(parseMigrationList(dataOf(fixture('ef8-list.txt')))?.map((m) => m.name)).toEqual([
      'Init',
      'AddOrders',
    ]);
  });

  it('drops bad rows, refuses non-JSON and caps at 1,000', () => {
    expect(
      parseMigrationList([
        '[{"id":"nope","name":"X","applied":true},{"id":"20260101000000_A","name":"A","safeName":"A","applied":false}]',
      ]),
    ).toEqual([{ id: '20260101000000_A', name: 'A', applied: false }]);
    expect(parseMigrationList(['not json'])).toBeNull();
    expect(parseMigrationList(['{"id":1}'])).toBeNull();
    expect(parseMigrationList([])).toBeNull();
    const many = Array.from({ length: 1_200 }, (_, i) => ({
      id: `2026010100${String(i).padStart(4, '0')}_M${i}`,
      name: `M${i}`,
      applied: false,
    }));
    expect(parseMigrationList([JSON.stringify(many)])).toHaveLength(1_000);
  });
});

it('recognises the not-restored message', () => {
  expect(mentionsRestore(fixture('not-restored.txt'))).toBe(true);
  expect(mentionsRestore('Build failed.')).toBe(false);
});
