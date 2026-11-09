import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        // Preserve the browser host for the API origin check.
        changeOrigin: false,
      },
      '/ws': {
        target: 'ws://localhost:4000',
        changeOrigin: false,
        ws: true,
      },
    },
  },
});
