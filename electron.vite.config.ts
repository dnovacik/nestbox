import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import svgr from 'vite-plugin-svgr';
import { buildCsp } from './src/main/security/csp';

const shared = resolve('src/shared');

/** Injects the strict production CSP as a <meta> tag. Dev CSP is set as a header by main. */
function cspMeta(): Plugin {
  return {
    name: 'nestbox-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      const meta = `<meta http-equiv="Content-Security-Policy" content="${buildCsp({ dev: false })}" />`;
      return html.replace('<head>', `<head>\n    ${meta}`);
    },
  };
}

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    // electron-store is ESM-only; bundle it into the CommonJS main bundle.
    build: { externalizeDeps: { exclude: ['electron-store'] } },
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    // Sandboxed preload cannot require() files: bundle everything.
    build: { externalizeDeps: false },
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer'),
        '@shared': shared,
        '@brand': resolve('resources/brand'),
      },
    },
    plugins: [react(), tailwindcss(), svgr(), cspMeta()],
  },
});
