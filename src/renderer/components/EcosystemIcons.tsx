import type { SVGProps } from 'react';
import type { EcosystemId } from '@shared/detected';

// Import devicon SVGs as React components
import DotNetSvg from 'devicon/icons/dot-net/dot-net-plain.svg?react';
import PythonSvg from 'devicon/icons/python/python-plain.svg?react';
import NodeJsSvg from 'devicon/icons/nodejs/nodejs-plain.svg?react';

/**
 * Wrapper components for devicon SVGs.
 * The devicon SVGs have hardcoded colors, so we use them as-is.
 */

function DotNetIcon(props: SVGProps<SVGSVGElement>) {
  return <DotNetSvg {...props} />;
}

function PythonIcon(props: SVGProps<SVGSVGElement>) {
  return <PythonSvg {...props} />;
}

function NodeJsIcon(props: SVGProps<SVGSVGElement>) {
  return <NodeJsSvg {...props} />;
}

/**
 * Get the icon component for an ecosystem.
 * Returns a React component that renders the devicon icon.
 */
export function getEcosystemIcon(id: EcosystemId): React.ComponentType<SVGProps<SVGSVGElement>> {
  switch (id) {
    case 'dotnet':
      return DotNetIcon;
    case 'python':
      return PythonIcon;
    case 'node':
      return NodeJsIcon;
    default:
      return DotNetIcon; // Fallback
  }
}
