// Runs before `npm run dev`. Vite must use 127.0.0.1:<CIQ_WEB_PORT, default 5173> because the API
// only accepts browser writes from that origin. We never stop other processes or pick another port.
import net from 'node:net'

const PORT = Number(process.env.CIQ_WEB_PORT || 5173)
const probe = net.createServer()
probe.once('error', (err) => {
  console.error(
    `\n  Port ${PORT} on 127.0.0.1 is not available (${err.code}).\n` +
      `  CustomerIQ's API only accepts browser requests from http://127.0.0.1:${PORT} or\n` +
      `  http://localhost:${PORT}, so the dev server will not switch to another port.\n` +
      `  Find the process with:  netstat -ano | findstr :${PORT}\n` +
      `  Stop it yourself if it is safe to, or pick a free port for both servers:\n` +
      `    python -m src.api --web-port 5180     and     $env:CIQ_WEB_PORT=5180; npm run dev\n`,
  )
  process.exit(1)
})
probe.once('listening', () => probe.close())
probe.listen(PORT, '127.0.0.1')
