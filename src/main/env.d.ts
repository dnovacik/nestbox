/// <reference types="vite-plugin-svgr/client" />

// Type declarations for SVG imports in main process
declare module '*.svg?react' {
  import type { SVGProps } from 'react';
  const Component: React.ComponentType<SVGProps<SVGSVGElement>>;
  export default Component;
}
