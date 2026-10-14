// Test helpers: a NodeInfo with defaults (npm from a package-lock.json, no framework) and the ecosystem entry
// detection gives a folder with a package.json, so tests name only what they're about. Never imported by
// production modules.
import type { EcosystemEntry } from '../detected';
import type { NodeInfo } from './node';

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

/** The Node entry of a package with a package.json. */
export function nodeEntry(over: Partial<NodeInfo> = {}): EcosystemEntry {
  return { id: 'node', info: nodeInfo(over) };
}
