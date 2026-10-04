import type { NodeStatus } from '@shared/tools/node/contract';

export function nodeStatus(over: Partial<NodeStatus> = {}): NodeStatus {
  return {
    state: 'ok',
    sources: [{ kind: 'nvmrc', value: '20', fromRoot: false, valid: true, conflict: false }],
    requirement: 'nvmrc',
    node: { version: 'v20.11.1', ok: true },
    packageManager: null,
    manager: null,
    fnm: { available: false, on: false, version: '20' },
    checkedAt: Date.now(),
    ...over,
  };
}
