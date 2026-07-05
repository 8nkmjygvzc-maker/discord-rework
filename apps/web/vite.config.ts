import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Direkt auf die TS-Quelle statt auf den CJS-Build: Vite/Rollup können
      // CJS-Re-Exports (enums!) nicht statisch auflösen, TS-Quellen schon.
      '@parley/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    // Proxy statt CORS: /api-Anfragen gehen im Dev-Modus an das NestJS-Backend,
    // /gateway ist die WebSocket-Verbindung zum Echtzeit-Gateway.
    proxy: {
      '/api': 'http://localhost:3001',
      '/gateway': { target: 'ws://localhost:3001', ws: true },
    },
  },
});
