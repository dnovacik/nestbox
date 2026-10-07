import { describe, expect, it } from 'vitest';
import { nodeModule } from './node';

describe('nodeModule.detect', () => {
  it('detects pnpm projects', async () => {
    const files = new Set(['package.json', 'pnpm-lock.yaml']);
    const result = await nodeModule.detect('/test', files, new Set());

    expect(result).toEqual({
      packageManager: 'pnpm',
      hasStartScript: false,
      hasDevScript: false,
      hasTestScript: false,
      hasBuildScript: false,
    });
  });

  it('detects npm projects', async () => {
    const files = new Set(['package.json', 'package-lock.json']);
    const result = await nodeModule.detect('/test', files, new Set());

    expect(result?.packageManager).toBe('npm');
  });

  it('detects yarn projects', async () => {
    const files = new Set(['package.json', 'yarn.lock']);
    const result = await nodeModule.detect('/test', files, new Set());

    expect(result?.packageManager).toBe('yarn');
  });

  it('detects bun projects', async () => {
    const files = new Set(['package.json', 'bun.lockb']);
    const result = await nodeModule.detect('/test', files, new Set());

    expect(result?.packageManager).toBe('bun');
  });

  it('defaults to npm when no lockfile', async () => {
    const files = new Set(['package.json']);
    const result = await nodeModule.detect('/test', files, new Set());

    expect(result?.packageManager).toBe('npm');
  });

  it('prioritizes pnpm over others', async () => {
    const files = new Set(['package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']);
    const result = await nodeModule.detect('/test', files, new Set());

    expect(result?.packageManager).toBe('pnpm');
  });

  it('returns null when no package.json', async () => {
    const files = new Set(['README.md']);
    const result = await nodeModule.detect('/test', files, new Set());

    expect(result).toBeNull();
  });
});

describe('nodeModule.tasks', () => {
  it('provides install task', () => {
    const tasks = nodeModule.tasks({
      packageManager: 'pnpm',
      hasStartScript: false,
      hasDevScript: false,
      hasTestScript: false,
      hasBuildScript: false,
    });

    expect(tasks).toContainEqual({
      name: 'install',
      argv: ['pnpm', 'install'],
      title: 'Install dependencies',
    });
  });

  it('provides dev task when dev script exists', () => {
    const tasks = nodeModule.tasks({
      packageManager: 'npm',
      hasStartScript: false,
      hasDevScript: true,
      hasTestScript: false,
      hasBuildScript: false,
    });

    expect(tasks).toContainEqual({
      name: 'dev',
      argv: ['npm', 'run', 'dev'],
      title: 'Dev',
    });
  });

  it('provides start task when only start script exists', () => {
    const tasks = nodeModule.tasks({
      packageManager: 'npm',
      hasStartScript: true,
      hasDevScript: false,
      hasTestScript: false,
      hasBuildScript: false,
    });

    expect(tasks).toContainEqual({
      name: 'start',
      argv: ['npm', 'run', 'start'],
      title: 'Start',
    });
  });

  it('prefers dev over start', () => {
    const tasks = nodeModule.tasks({
      packageManager: 'npm',
      hasStartScript: true,
      hasDevScript: true,
      hasTestScript: false,
      hasBuildScript: false,
    });

    const hasDevTask = tasks.some((t) => t.name === 'dev');
    const hasStartTask = tasks.some((t) => t.name === 'start');

    expect(hasDevTask).toBe(true);
    expect(hasStartTask).toBe(false);
  });

  it('provides test task when test script exists', () => {
    const tasks = nodeModule.tasks({
      packageManager: 'yarn',
      hasStartScript: false,
      hasDevScript: false,
      hasTestScript: true,
      hasBuildScript: false,
    });

    expect(tasks).toContainEqual({
      name: 'test',
      argv: ['yarn', 'run', 'test'],
      title: 'Test',
    });
  });

  it('provides build task when build script exists', () => {
    const tasks = nodeModule.tasks({
      packageManager: 'bun',
      hasStartScript: false,
      hasDevScript: false,
      hasTestScript: false,
      hasBuildScript: true,
    });

    expect(tasks).toContainEqual({
      name: 'build',
      argv: ['bun', 'run', 'build'],
      title: 'Build',
    });
  });

  it('only provides install when no scripts exist', () => {
    const tasks = nodeModule.tasks({
      packageManager: 'npm',
      hasStartScript: false,
      hasDevScript: false,
      hasTestScript: false,
      hasBuildScript: false,
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.name).toBe('install');
  });
});

describe('nodeModule.summary', () => {
  it('shows package manager', () => {
    const summary = nodeModule.summary?.({
      packageManager: 'pnpm',
      hasStartScript: false,
      hasDevScript: false,
      hasTestScript: false,
      hasBuildScript: false,
    });

    expect(summary).toBe('Node.js · pnpm');
  });
});
