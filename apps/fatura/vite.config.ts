import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Fatura Azit — mini-app público (doc 02 §32.2). Mesmo padrão do frontend:
// @azit/* resolvem para os src/ dos pacotes; porta 3002 em dev; /api vai ao backend.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@azit/types': path.resolve(__dirname, '../../packages/types/src'),
      '@azit/utils': path.resolve(__dirname, '../../packages/utils/src'),
    },
  },
  server: {
    port: 3002,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
