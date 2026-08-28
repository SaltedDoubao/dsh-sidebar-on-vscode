import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'

const args = process.argv.slice(2)
const captureIndex = args.indexOf('--capture')
if (captureIndex >= 0) writeFileSync(args[captureIndex + 1], JSON.stringify(args), 'utf8')

if (args.includes('--require-expose-internals') && !process.execArgv.includes('--expose-internals')) {
  process.stderr.write('Error: fixture requires --expose-internals\n')
  process.exit(19)
}

if (args.includes('--exit-immediately')) {
  process.stderr.write('apiKey=fixture-secret startup failed\n')
  process.exit(17)
}

if (args.includes('--never-ready')) {
  setInterval(() => undefined, 1_000)
} else {
  const hostIndex = args.indexOf('--host')
  const portIndex = args.indexOf('--port')
  const host = hostIndex >= 0 ? args[hostIndex + 1] : '127.0.0.1'
  const port = Number(portIndex >= 0 ? args[portIndex + 1] : 0)
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/api/host.describe') {
      res.writeHead(404).end()
      return
    }
    let raw = ''
    req.on('data', (chunk) => { raw += String(chunk) })
    req.on('end', () => {
      const request = JSON.parse(raw)
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        type: 'server-response',
        rpcId: request.rpcId,
        result: {
          ok: true,
          value: { version: 'fixture', cwd: process.cwd(), attachedSessions: 0, canOpenPath: false },
        },
      }))
    })
  })
  server.listen(port, host)
  process.once('SIGTERM', () => server.close(() => process.exit(0)))
  process.once('SIGINT', () => server.close(() => process.exit(0)))
}
