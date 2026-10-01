import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const backend = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Consume the shared package from source so edits apply without a rebuild.
      '@agent-board/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  build: {
    // One small SPA; a single ~600 kB chunk (190 kB gzip) is fine for an internal tool.
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/socket.io': { target: backend, changeOrigin: true, ws: true },
    },
  },
});
