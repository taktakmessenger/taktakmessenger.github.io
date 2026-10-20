import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite 5 rejects any Host header it does not recognise (DNS-rebinding
// protection). In a cloud dev container the app is reached through a proxy on a
// public hostname, so the default localhost-only list would answer 403 and the
// page would look blank. Extra hosts can be added with VITE_ALLOWED_HOSTS.
const allowedHosts = process.env.VITE_ALLOWED_HOSTS
  ? process.env.VITE_ALLOWED_HOSTS.split(',').map((h) => h.trim())
  : ['.prod-runtime.all-hands.dev', 'localhost', '127.0.0.1'];

export default defineConfig({
  // Relative asset URLs so the built bundle also works when it is served from a
  // sub-path or opened straight from disk, not just from the domain root.
  base: './',
  plugins: [react()],
  server: {
    host: true,
    port: Number(process.env.PORT) || 3000,
    allowedHosts,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://localhost:4000',
        changeOrigin: true,
      },
      // Socket.IO shares the HTTP server with the API, so it needs the same
      // proxy. `ws: true` upgrades the connection; without it the client falls
      // back to polling and the live chat and calls feel sluggish.
      '/socket.io': {
        target: process.env.VITE_API_PROXY || 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
      },
      // Uploaded originals and HLS renditions are served by the backend. Without
      // this rule the dev server answers /uploads/* with index.html, so every
      // freshly uploaded video fails to play (production nginx already proxies
      // this path).
      '/uploads': {
        target: process.env.VITE_API_PROXY || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    port: Number(process.env.PORT) || 4173,
    allowedHosts,
  },
});
