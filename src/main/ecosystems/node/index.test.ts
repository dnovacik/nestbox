import { describe, expect, it } from 'vitest';
import { detectNode } from './detect';
import { nodeModule } from './index';
import { nodeTasks } from './tasks';

describe('nodeModule', () => {
  it('detects and lists tasks through detect.ts and tasks.ts', () => {
    expect(nodeModule.id).toBe('node');
    expect(nodeModule.detect).toBe(detectNode);
    expect(nodeModule.tasks).toBe(nodeTasks);
    expect(nodeModule.packageGlobs).toEqual(['*/package.json', '*/*/package.json']);
  });

  it('needs no special environment', async () => {
    expect(
      await nodeModule.runEnv(
        { dir: '/x', platform: {} as never, settings: {} },
        { packageManager: 'npm' },
      ),
    ).toEqual({});
  });
});

describe('nodeModule.summary', () => {
  it('names the package manager', () => {
    expect(nodeModule.summary?.({ packageManager: 'yarn' })).toBe('Node.js · yarn');
  });
});
