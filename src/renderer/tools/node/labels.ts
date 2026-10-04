import {
  type NodeState,
  type NodeStatus,
  SOURCE_LABELS,
  type VersionManager,
} from '@shared/tools/node/contract';

export const STATE_LABEL: Record<NodeState, string> = {
  ok: 'Versions match',
  mismatch: "Versions don't match",
  conflict: 'The sources disagree',
  unknown: "Can't tell",
};

/** Dot colour per state (tokens only). */
export const STATE_TONE: Record<NodeState, string> = {
  ok: 'bg-ok',
  mismatch: 'bg-err',
  conflict: 'bg-warn',
  unknown: 'bg-fg-faint',
};

/** "20 (.nvmrc)", or null without a requirement. */
export function requirementText(status: NodeStatus): string | null {
  const source = status.sources.find((s) => s.kind === status.requirement);
  return source
    ? `${source.value ?? '?'} (${SOURCE_LABELS[source.kind]}${source.fromRoot ? ', root' : ''})`
    : null;
}

export function managerHint(manager: VersionManager | null): string {
  switch (manager) {
    case 'fnm':
      return "fnm can run this project's scripts on the required version.";
    case 'volta':
      return 'Volta switches Node per project on its own.';
    case 'nvm-windows':
      return 'nvm-windows switches Node for the whole machine, so NestBox only warns. Run nvm use yourself.';
    case 'nvm':
      return 'nvm switches Node per shell, so NestBox only warns. Run nvm use in your terminal.';
    case null:
      return 'No version manager found (fnm, Volta or nvm).';
  }
}
