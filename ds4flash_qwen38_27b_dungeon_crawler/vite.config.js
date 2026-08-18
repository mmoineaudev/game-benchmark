import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    // HMR client must talk to the same host we're bound to, otherwise the
    // dev-client falls back to ws://localhost:undefined and throws.
    hmr: { host: '127.0.0.1', port: 5173, protocol: 'ws:' },
  },
});
