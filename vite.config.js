import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5174',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const xf = req.headers['x-forwarded-for'];
            if (xf) proxyReq.setHeader('X-Forwarded-For', xf);
          });
        },
      },
    },
  },
})
