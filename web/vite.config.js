import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/streams':   'http://10.67.18.30:3000',
      '/transcode': 'http://10.67.18.30:3000',
      '/multicast': 'http://10.67.18.30:3000',
      '/analyse':   'http://10.67.18.30:3000',
      '/pipeline':  'http://10.67.18.30:3000',
      '/scte35':    'http://10.67.18.30:3000',
      '/health':    'http://10.67.18.30:3000',
    },
  },
  build: {
    outDir: 'dist',
  },
});
