import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/** يقلّل «render-blocking» لملف CSS المُولَّد: preload ثم تطبيق كـ stylesheet بعد التحميل */
function asyncCssPlugin() {
  return {
    name: 'async-css',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (ctx.server) return html
        return html.replace(
          /<link rel="stylesheet"( crossorigin)? href="(\/assets\/[^"]+\.css)">/,
          (_, crossorigin, href) => {
            const co = crossorigin || ''
            return `<link rel="preload" href="${href}" as="style" onload="this.onload=null;this.rel='stylesheet'"${co}>\n    <noscript><link rel="stylesheet" href="${href}"${co}></noscript>`
          },
        )
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const siteUrl = (env.VITE_SITE_URL || 'https://tetheriq.store').replace(/\/$/, '')

  return {
  plugins: [
    react(),
    asyncCssPlugin(),
    {
      name: 'html-site-url',
        transformIndexHtml(html) {
        return html.replaceAll('__SITE_URL__', siteUrl)
      },
    },
  ],
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
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
