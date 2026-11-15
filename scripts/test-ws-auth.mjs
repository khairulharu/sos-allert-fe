// Regression test for the SOS tracking WebSocket auth contract (backend F-8):
// the session token must never ride in the URL, the first frame is
// {"type":"auth","token":...}, and no breadcrumb may leave the client before
// the server answers {"type":"auth_ok"}.
//
// Runs the real Vite dev server in headless Chrome against a minimal WebSocket
// server on :3000 (hand-rolled handshake, no dependency) and checks, in order:
//   1. the upgrade URL carries no query string (no ?token=),
//   2. frame #1 is the auth frame with the stored token,
//   3. breadcrumbs sent while the socket connected/auth was pending arrive
//      only after auth_ok, and the store flips to connection:'open' then,
//   4. with no token at all, no socket is opened and the channel reports error.
//
// Run: npm run test:ws   (needs Google Chrome; /usr/bin/google-chrome)

import http from 'node:http'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { createServer as createViteServer } from 'vite'
import { MOBILE_VIEWPORT } from './mobile-viewport.mjs'

const API_PORT = 3000
const APP_PORT = 5173
const APP_URL = `http://localhost:${APP_PORT}`
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome'
const TOKEN = 'mock-session-token'
const ALERT_ID = 'alt_ws_test'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---- minimal WebSocket server ----------------------------------------------
const connections = [] // { url, frames: [], authOkSentAt }

function encodeFrame(text) {
  const payload = Buffer.from(text)
  assert.ok(payload.length < 126, 'test frames stay in the 7-bit length form')
  return Buffer.concat([Buffer.from([0x81, payload.length]), payload])
}

// Client frames are masked; only the single-frame text case is needed here.
function decodeFrames(state) {
  const out = []
  for (;;) {
    const buf = state.buffer
    if (buf.length < 2) break
    const opcode = buf[0] & 0x0f
    const masked = (buf[1] & 0x80) !== 0
    let length = buf[1] & 0x7f
    let offset = 2
    if (length === 126) {
      if (buf.length < 4) break
      length = buf.readUInt16BE(2)
      offset = 4
    }
    const maskLen = masked ? 4 : 0
    if (buf.length < offset + maskLen + length) break
    const mask = masked ? buf.subarray(offset, offset + 4) : null
    const data = Buffer.from(buf.subarray(offset + maskLen, offset + maskLen + length))
    if (mask) for (let i = 0; i < data.length; i += 1) data[i] ^= mask[i % 4]
    // Only text frames matter here; close/ping/pong are ignored.
    if (opcode === 0x1) out.push(data.toString('utf8'))
    state.buffer = buf.subarray(offset + maskLen + length)
  }
  return out
}

const server = http.createServer((req, res) => {
  // Nothing else is needed: the app shows the sign-in screen with no token.
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ errors: 'no mock route' }))
})

server.on('upgrade', (req, socket) => {
  if (!req.url.startsWith('/ws/sos/')) {
    socket.destroy()
    return
  }
  const accept = crypto
    .createHash('sha1')
    .update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64')
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )

  const conn = { url: req.url, frames: [], authOkAt: 0, socket }
  connections.push(conn)
  const state = { buffer: Buffer.alloc(0) }

  socket.on('data', (chunk) => {
    state.buffer = Buffer.concat([state.buffer, chunk])
    for (const text of decodeFrames(state)) {
      conn.frames.push(text)
      const frame = JSON.parse(text)
      if (frame.type === 'auth') {
        conn.authOkAt = conn.frames.length
        socket.write(encodeFrame(JSON.stringify({ type: 'auth_ok' })))
      }
    }
  })
  socket.on('error', () => {})
})

let vite
let browser

try {
  await new Promise((resolve) => server.listen(API_PORT, resolve))
  vite = await createViteServer({
    logLevel: 'error',
    server: { port: APP_PORT, strictPort: true, hmr: false },
  })
  await vite.listen()
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: MOBILE_VIEWPORT })
  await page.goto(APP_URL, { waitUntil: 'load' })

  // 1-3. A channel with a stored token, plus breadcrumbs sent too early.
  await page.evaluate(
    async ({ token, alertId }) => {
      localStorage.setItem('sos_alert_token', token)
      const mod = await import('/src/lib/tracking.js')
      window.__tracking = mod
      window.__states = []
      mod.tracking.subscribe((state) => window.__states.push(state))
      mod.startTracking(alertId)
      mod.sendBreadcrumb({ latitude: -6.2, longitude: 106.8 }) // while connecting
      await new Promise((r) => setTimeout(r, 50))
      mod.sendBreadcrumb({ latitude: -6.21, longitude: 106.81 }) // maybe pre-auth
    },
    { token: TOKEN, alertId: ALERT_ID },
  )
  await sleep(600)

  assert.equal(connections.length, 1, 'exactly one socket is opened')
  const conn = connections[0]
  assert.equal(conn.url, `/ws/sos/${ALERT_ID}/track`, 'no token in the URL')
  assert.ok(!conn.url.includes('token'), 'no token in the URL')

  const first = JSON.parse(conn.frames[0])
  assert.deepEqual(first, { type: 'auth', token: TOKEN }, 'first frame is the auth frame')
  assert.equal(conn.authOkAt, 1, 'auth_ok is only sent after the auth frame')

  const breadcrumbs = conn.frames.slice(1).map((f) => JSON.parse(f))
  assert.equal(breadcrumbs.length, 2, 'both breadcrumbs are delivered, none dropped')
  for (const frame of breadcrumbs) {
    assert.ok(Number.isFinite(frame.latitude), 'a breadcrumb, not an auth frame')
    assert.equal(frame.type, undefined, 'no auth frame after the first one')
  }

  const final = await page.evaluate(() => {
    let value
    window.__tracking.tracking.subscribe((s) => (value = s))()
    return value
  })
  assert.equal(final.connection, 'open', 'channel is open only after auth_ok')
  assert.equal(final.lastError, '')

  // 4. No token: no socket at all, and the channel reports the reason.
  const before = connections.length
  const noToken = await page.evaluate(async () => {
    // setToken(null) is what logout() does: it also clears the in-memory cache.
    const api = await import('/src/lib/api.js')
    api.setToken(null)
    const mod = window.__tracking
    mod.startTracking('alt_ws_no_token')
    await new Promise((r) => setTimeout(r, 300))
    let value
    mod.tracking.subscribe((s) => (value = s))()
    return value
  })
  assert.equal(connections.length, before, 'no socket is opened without a token')
  assert.equal(noToken.connection, 'error')
  assert.match(noToken.lastError, /Sign in again/)

  console.log('ok — ws auth: no token in URL, auth frame first, queue flushed on auth_ok')
  console.log(`   frames: ${conn.frames.length} (auth + ${breadcrumbs.length} breadcrumbs)`)
} finally {
  await browser?.close()
  await vite?.close()
  // server.close() waits for live sockets; the tracked one is still open.
  for (const conn of connections) conn.socket.destroy()
  await new Promise((resolve) => server.close(resolve))
}
