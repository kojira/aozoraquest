import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: { port: 9999, strictPort: true },
  preview: { port: 9999 },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
  },
});
