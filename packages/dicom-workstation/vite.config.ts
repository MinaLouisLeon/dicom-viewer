import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import pkg from './package.json' with { type: 'json' };

// Peers (including the free viewer package and Cornerstone) stay external, so an app
// has exactly one copy of each and one Cornerstone initialization.
const externalPackages = [...Object.keys(pkg.peerDependencies), 'vite'];
const isExternal = (id: string) =>
  id.startsWith('node:') || externalPackages.some((name) => id === name || id.startsWith(`${name}/`));

const viewerSource = (file: string) => fileURLToPath(new URL(`../dicom-viewer/src/${file}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: false,
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: {
      entry: {
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        vite: fileURLToPath(new URL('./src/vite.ts', import.meta.url)),
      },
      formats: ['es'],
      cssFileName: 'styles',
    },
    rolldownOptions: {
      external: isExternal,
      output: {
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
  test: {
    // Tests run against the viewer's sources, so they do not need a build first.
    alias: [
      { find: /^@mihawksolutions\/dicom-viewer\/internal\/cornerstone$/, replacement: viewerSource('internalCornerstone.ts') },
      { find: /^@mihawksolutions\/dicom-viewer\/internal$/, replacement: viewerSource('internal.ts') },
      { find: /^@mihawksolutions\/dicom-viewer$/, replacement: viewerSource('index.ts') },
    ],
    server: { deps: { inline: ['@cornerstonejs/dicom-image-loader'] } },
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    css: false,
  },
});
