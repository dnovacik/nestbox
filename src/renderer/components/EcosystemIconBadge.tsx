import type { EcosystemId } from '@shared/detected';
import { DotnetIcon, EcosystemIcon, NodeIcon, PythonIcon } from './EcosystemIcons';

interface EcosystemIconProps {
  id: EcosystemId;
  className?: string;
}

/**
 * Renders the appropriate icon for an ecosystem ID.
 * Falls back to generic icon for unknown types.
 */
export function EcosystemIconBadge({ id, className }: EcosystemIconProps) {
  const Icon = getEcosystemIcon(id);
  return <Icon className={className} aria-label={`${id} ecosystem`} />;
}

function getEcosystemIcon(id: EcosystemId) {
  switch (id) {
    case 'dotnet':
      return DotnetIcon;
    case 'python':
      return PythonIcon;
    case 'node':
      return NodeIcon;
    default:
      return EcosystemIcon;
  }
}
