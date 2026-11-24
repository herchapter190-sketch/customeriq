import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The API (python -m src.api) listens on 127.0.0.1:8520 only. The browser talks to it
// same-origin through this proxy, so no CORS, tokens or API URLs ever reach frontend code.
// Both ports can be overridden (e.g. when 5173 is taken by another app); hosts stay loopback-only.
// The API must then be started with the matching  --web-port  so its Origin check accepts this server.
function portFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1024 || n > 65535) throw new Error(`${name} must be a port between 1024 and 65535`)
  return n
}
const WEB_PORT = portFromEnv('CIQ_WEB_PORT', 5173)
const API_TARGET = `http://127.0.0.1:${portFromEnv('CIQ_API_PORT', 8520)}`

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    // The API's Origin check only accepts this exact port (its --web-port) for browser writes,
    // so Vite must never silently move to another port.
    port: WEB_PORT,
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
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks: React (needed for first paint) and the 3D stack, which only the
        // lazily-loaded stage imports. React has the higher priority so the 3D group (which pulls in
        // its dependencies) cannot capture it, and the first paint never waits for three.js.
        codeSplitting: {
          groups: [
            { name: 'vendor-react', priority: 20, test: /[\/]node_modules[\/](react|react-dom|react-router|react-router-dom|scheduler|cookie|set-cookie-parser)[\/]/ },
            { name: 'vendor-3d', priority: 10, test: /[\/]node_modules[\/](three|@react-three|three-stdlib|troika-[^\/]+|bidi-js|webgl-sdf-generator|maath|meshline|camera-controls|@monogrid|stats-gl|stats\.js|zustand|suspend-react|its-fine|react-use-measure|react-reconciler|use-sync-external-store|gsap|detect-gpu|hls\.js|tunnel-rat|@use-gesture|glsl-noise|@mediapipe)[\/]/ },
          ],
        },
      },
    },
  },
})
