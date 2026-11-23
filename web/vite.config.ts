import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The API (python -m src.api) listens on 127.0.0.1:8520 only. The browser talks to it
// same-origin through this proxy, so no CORS, tokens or API URLs ever reach frontend code.
const API_TARGET = 'http://127.0.0.1:8520'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    // The API's Origin check only accepts http://127.0.0.1:5173 and http://localhost:5173 for
    // browser writes, so Vite must never silently move to another port.
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: false, // keep Host/Origin as the browser sent them; the API validates both
        xfwd: false,
        configure(proxy) {
          // Answer with a recognisable 502 when the API is not running (instead of a bare 500).
          proxy.on('error', (_err, _req, res) => {
            const r = res as unknown as {
              headersSent?: boolean
              writeHead?: (s: number, h: Record<string, string>) => void
              end: (b?: string) => void
            }
            if (typeof r.writeHead === 'function' && !r.headersSent) {
              r.writeHead(502, { 'content-type': 'application/json', 'x-ciq-proxy': 'unreachable' })
              r.end(JSON.stringify({ detail: 'The CustomerIQ API is not reachable' }))
            }
          })
        },
      },
    },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { sourcemap: false, chunkSizeWarningLimit: 1500 },
})
