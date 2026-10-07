import type { SVGProps } from 'react';

/**
 * Ecosystem icon components - small monochrome icons that adapt to theme.
 * Size: 14x14px to match text line height.
 */

export function DotnetIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <title>.NET</title>
      {/* .NET logo simplified - hex shape with dot */}
      <path
        d="M7 1L12 4V10L7 13L2 10V4L7 1Z"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
      />
      <circle cx="9.5" cy="7" r="1.2" fill="currentColor" />
    </svg>
  );
}

export function PythonIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <title>Python</title>
      {/* Python logo simplified - two snakes */}
      <path
        d="M4 2H7C8.5 2 9 2.5 9 4V6H5V7H10C11 7 11.5 7.5 11.5 9C11.5 10.5 11 11 10 11H8V9C8 7.5 7.5 7 6 7H4C2.5 7 2 6.5 2 5V4C2 2.5 2.5 2 4 2Z"
        stroke="currentColor"
        strokeWidth="1"
        fill="none"
      />
      <circle cx="5.5" cy="4" r="0.8" fill="currentColor" />
    </svg>
  );
}

export function NodeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <title>Node.js</title>
      {/* Node.js logo simplified - hexagon */}
      <path
        d="M7 1L12 4V10L7 13L2 10V4L7 1Z"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
      />
      <path
        d="M7 5V9M5 6.5L7 5L9 6.5M5 7.5L7 9L9 7.5"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Generic fallback icon for unknown ecosystems
 */
export function EcosystemIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <title>Ecosystem</title>
      <rect
        x="2"
        y="2"
        width="10"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
      />
      <path
        d="M5 7H9M7 5V9"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
