import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';

const alias = {
  '@': resolve('src/renderer'),
  '@shared': resolve('src/shared'),
  '@brand': resolve('resources/brand'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/{main,preload,shared}/**/*.test.ts', 'tests/**/*.test.ts'],
        },
      },
      {
        extends: true,
        plugins: [react(), svgr()],
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['src/renderer/test/setup.ts'],
        },
      },
    ],
  },
});
