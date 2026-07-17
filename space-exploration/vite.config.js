import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'es2020' },
  server: { open: '/launcher.html' },
  preview: { open: '/launcher.html' },
});
