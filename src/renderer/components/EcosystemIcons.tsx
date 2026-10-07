import { Box, Code2, type LucideIcon, Package2 } from 'lucide-react';
import type { EcosystemId } from '@shared/detected';

/**
 * Get the lucide-react icon for an ecosystem.
 * Returns the icon component that can be rendered with size-3.5 className.
 */
export function getEcosystemIcon(id: EcosystemId): LucideIcon {
  switch (id) {
    case 'dotnet':
      return Box; // Hexagon-like box shape for .NET
    case 'python':
      return Code2; // Code brackets for Python
    case 'node':
      return Package2; // Package for Node.js
    default:
      return Box; // Fallback
  }
}
