/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />
import type { NestboxBridge } from '@shared/bridge';

declare global {
  interface Window {
    nestbox: NestboxBridge;
  }
}
