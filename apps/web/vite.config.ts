import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Proxy statt CORS: /api-Anfragen gehen im Dev-Modus an das NestJS-Backend.
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
