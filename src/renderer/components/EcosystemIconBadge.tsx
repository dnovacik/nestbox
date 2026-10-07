import type { EcosystemId } from '@shared/detected';
import { getEcosystemIcon } from './EcosystemIcons';

interface EcosystemIconProps {
  id: EcosystemId;
  className?: string;
}

/**
 * Renders the appropriate icon for an ecosystem ID.
 * Uses lucide-react icons at size-3.5.
 */
export function EcosystemIconBadge({ id, className }: EcosystemIconProps) {
  const Icon = getEcosystemIcon(id);
  return <Icon aria-hidden className={className} />;
}
