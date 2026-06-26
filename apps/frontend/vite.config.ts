import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Frontend resolve @azit/* direto para os src/ dos pacotes (não usa o dist) — Doc 4 §5.4.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@azit/types': path.resolve(__dirname, '../../packages/types/src'),
      '@azit/utils': path.resolve(__dirname, '../../packages/utils/src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
