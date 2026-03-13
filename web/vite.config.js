import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const appVersion = process.env.npm_package_version || '0.0.0';
const releaseVersion = process.env.LABOTECH_RELEASE || `v${appVersion}`;
const buildTimeUtc = new Date().toISOString();

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
    'import.meta.env.VITE_RELEASE_VERSION': JSON.stringify(releaseVersion),
    'import.meta.env.VITE_BUILD_TIME_UTC': JSON.stringify(buildTimeUtc),
  },
  server: {
    proxy: {
      '/streams': {
        target: 'http://127.0.0.1:4000',
        ws: true,
      },
      '/encap': 'http://127.0.0.1:4000',
      '/transcode': 'http://127.0.0.1:4000',
      '/multicast': 'http://127.0.0.1:4000',
      '/analyse': 'http://127.0.0.1:4000',
      '/pipeline': 'http://127.0.0.1:4000',
      '/scte35': 'http://127.0.0.1:4000',
      '/health': 'http://127.0.0.1:4000',
      '/logs': 'http://127.0.0.1:4000',
      '/etr290': 'http://127.0.0.1:4000',
      '/api': 'http://127.0.0.1:4000',
      '/ws': { target: 'ws://127.0.0.1:4000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-motion': ['framer-motion'],
          'vendor-charts': ['recharts'],
          'vendor-radix': ['@radix-ui/react-dialog', '@radix-ui/react-tabs', '@radix-ui/react-tooltip'],
          'vendor-query': ['@tanstack/react-query'],
        },
      },
    },
  },
});
