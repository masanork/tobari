import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
  ],
  resolve: {
    alias: {
      // workspace aliases if needed, but Vite handles them if configured
    },
  },
  optimizeDeps: {
    exclude: ['@tobari/civ']
  },
  server: {
    fs: {
      allow: ['../..']
    }
  }
});
