import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['localhost', '127.0.0.1'],
    port: 2002,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
        configure: (proxy) => {
          proxy.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'ECONNABORTED' || err.code === 'ECONNRESET') return;
            console.error('[socket proxy error]', err.message);
          });
        }
      }
    }
  },
  preview: {
    // vite preview (used in production via pm2) does NOT read the `server`
    // block above -- it needs its own host/proxy config, or /api and
    // /socket.io requests will 404.
    allowedHosts: true,
    port: 2002,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
        configure: (proxy) => {
          proxy.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'ECONNABORTED' || err.code === 'ECONNRESET') return;
            console.error('[socket proxy error]', err.message);
          });
        }
      }
    }
  }
});
