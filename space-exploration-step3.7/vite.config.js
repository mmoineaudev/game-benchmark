import { defineConfig } from 'vite';

export default defineConfig({
  build: { 
    target: 'es2020',
    sourcemap: true,
    minify: false,
  },
  root: '.',
  publicDir: 'public',
  server: { open: false },
});
