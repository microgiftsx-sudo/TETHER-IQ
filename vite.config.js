import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const siteUrl = (env.VITE_SITE_URL || 'https://tetheriq.store').replace(/\/$/, '')

  return {
  plugins: [
    react(),
    {
      name: 'html-site-url',
        transformIndexHtml(html) {
        return html.replaceAll('__SITE_URL__', siteUrl)
      },
    },
  ],
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
}
})
