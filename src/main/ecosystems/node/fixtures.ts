// Test helper: a NodeInfo with defaults (npm from a package-lock.json, no framework), so tests name only
// what they're about.
import type { NodeInfo } from './detect';

export function nodeInfo(over: Partial<NodeInfo> = {}): NodeInfo {
  return {
    name: null,
    scripts: {},
    packageManager: 'npm',
    packageManagerSource: 'lockfile',
    lockfiles: [],
    framework: null,
    ports: [],
    hasDependencies: false,
    monorepo: null,
    ...over,
  };
}
