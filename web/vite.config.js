import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/streams': {
        target: 'http://127.0.0.1:3000',
        ws: true,
      },
      '/transcode': 'http://127.0.0.1:3000',
      '/multicast': 'http://127.0.0.1:3000',
      '/analyse': 'http://127.0.0.1:3000',
      '/pipeline': 'http://127.0.0.1:3000',
      '/scte35': 'http://127.0.0.1:3000',
      '/health': 'http://127.0.0.1:3000',
      '/ws': { target: 'ws://127.0.0.1:3000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-motion': ['framer-motion'],
          'vendor-charts': ['recharts'],
          'vendor-radix': ['@radix-ui/react-dialog', '@radix-ui/react-tabs', '@radix-ui/react-tooltip'],
          'vendor-query': ['@tanstack/react-query'],
        },
      },
    },
  },
});
