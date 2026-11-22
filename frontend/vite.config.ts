import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Where the API runs while developing. The browser only ever talks to this dev server ("/api/..."),
  // so the session cookie stays first-party exactly like in production behind nginx.
  const apiTarget = env.VITE_DEV_API_TARGET || 'http://127.0.0.1:8002'
  const proxy = {
    '/api': { target: apiTarget, changeOrigin: false, xfwd: true },
  }

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // listens on this computer only; set VITE_DEV_HOST=0.0.0.0 on purpose to test from a phone on the LAN
      host: env.VITE_DEV_HOST || 'localhost',
      proxy,
    },
    preview: {
      port: 4173,
      host: env.VITE_DEV_HOST || 'localhost',
      proxy,
    },
    build: {
      // source maps would publish the readable source code of the application
      sourcemap: false,
      // every file is served from this site; nothing is embedded as a "data:" URL, so the
      // Content-Security-Policy can stay strict (font-src 'self', script-src 'self')
      assetsInlineLimit: 0,
    },
  }
})
