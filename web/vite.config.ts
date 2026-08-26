import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@shared': path.resolve(root, '../shared') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:25173',
      '/socket.io': { target: 'http://localhost:25173', ws: true },
    },
  },
});
