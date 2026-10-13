import { describe, expect, it } from 'vitest';
import { EF_ACTIONS } from '@shared/tools/database/contract';
import { efArgs, efLabel, needsConfirm } from './ef-command';

const base = {
  project: 'Shop.Api.csproj',
  context: null,
  environment: 'Development',
  idempotent: true,
};
const tail = [
  '--project',
  'Shop.Api.csproj',
  '--prefix-output',
  '--',
  '--environment',
  'Development',
];

describe('efArgs', () => {
  it('builds each command with the project, prefixes and the environment', () => {
    expect(efArgs({ ...base, action: 'list' })).toEqual([
      'ef',
      'migrations',
      'list',
      '--json',
      ...tail,
    ]);
    expect(efArgs({ ...base, action: 'add', name: 'AddOrders', context: 'ShopDbContext' })).toEqual(
      [
        'ef',
        'migrations',
        'add',
        'AddOrders',
        '--project',
        'Shop.Api.csproj',
        '--context',
        'ShopDbContext',
        '--prefix-output',
        '--',
        '--environment',
        'Development',
      ],
    );
    expect(efArgs({ ...base, action: 'update', target: '0' })).toEqual([
      'ef',
      'database',
      'update',
      '0',
      ...tail,
    ]);
    expect(efArgs({ ...base, action: 'update' })).toEqual(['ef', 'database', 'update', ...tail]);
    expect(efArgs({ ...base, action: 'script' })).toEqual([
      'ef',
      'migrations',
      'script',
      '--idempotent',
      ...tail,
    ]);
    expect(efArgs({ ...base, action: 'script', idempotent: false })).toEqual([
      'ef',
      'migrations',
      'script',
      ...tail,
    ]);
    expect(efArgs({ ...base, action: 'remove' })).toEqual(['ef', 'migrations', 'remove', ...tail]);
    expect(efArgs({ ...base, action: 'restore' })).toEqual(['tool', 'restore']);
  });

  it('never passes --connection, --verbose or --force', () => {
    for (const action of EF_ACTIONS) {
      const args = efArgs({ ...base, action, name: 'X', target: '0' });
      for (const flag of ['--connection', '--verbose', '-v', '--force', '-f'])
        expect(args).not.toContain(flag);
    }
  });
});

it('labels a run without its project file', () => {
  expect(efLabel(efArgs({ ...base, action: 'list' }), 'Production')).toBe(
    'dotnet ef migrations list --json (Production)',
  );
  expect(efLabel(efArgs({ ...base, action: 'restore' }), 'Production')).toBe('dotnet tool restore');
});

describe('needsConfirm', () => {
  it('asks for updates outside Development, any rollback and remove', () => {
    expect(needsConfirm('update', 'Development', undefined)).toBe(false);
    expect(needsConfirm('update', 'development', undefined)).toBe(false);
    expect(needsConfirm('update', 'Production', undefined)).toBe(true);
    expect(needsConfirm('update', 'Development', '0')).toBe(true);
    expect(needsConfirm('remove', 'Development', undefined)).toBe(true);
    for (const a of ['list', 'add', 'script', 'restore'] as const)
      expect(needsConfirm(a, 'Production', undefined)).toBe(false);
  });
});
