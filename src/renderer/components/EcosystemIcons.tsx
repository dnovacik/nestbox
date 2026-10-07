import type { SVGProps } from 'react';
import type { EcosystemId } from '@shared/detected';

// Import devicon SVGs as React components (renderer side only)
import DotNetSvg from 'devicon/icons/dot-net/dot-net-plain.svg?react';
import PythonSvg from 'devicon/icons/python/python-plain.svg?react';
import NodeJsSvg from 'devicon/icons/nodejs/nodejs-plain-wordmark.svg?react';

/**
 * Get the icon component for an ecosystem.
 * Icons are defined here in the renderer process since they use Vite's ?react imports.
 */
export function getEcosystemIcon(id: EcosystemId): React.ComponentType<SVGProps<SVGSVGElement>> {
  switch (id) {
    case 'dotnet':
      return DotNetSvg;
    case 'python':
      return PythonSvg;
    case 'node':
      return NodeJsSvg;
    default:
      // Fallback for unknown ecosystems
      return DotNetSvg;
  }
}
