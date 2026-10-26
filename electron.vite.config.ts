import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

const shared = { '@shared': resolve('src/shared') };
const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

export default defineConfig({
  main: {
    resolve: { alias: shared },
    build: {
      externalizeDeps: true,
      rollupOptions: {
        external: ['node-pty'],
        // The extension host runs as its own process (see ExtensionHostService).
        input: { index: resolve('src/main/index.ts'), host: resolve('src/host/index.ts') },
      },
    },
  },
  preload: {
    resolve: { alias: shared },
    // Sandboxed preloads must be CommonJS.
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    resolve: { alias: { ...shared, '@renderer': resolve('src/renderer/src') } },
    plugins: [preact(), tailwindcss()],
    define: { __SATURN_VERSION__: JSON.stringify(version) },
  },
});
