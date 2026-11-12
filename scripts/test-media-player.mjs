// Regression test for the responder media player (docs/api-changes.md → "Media
// insiden"), which the app now wires: GET /api/sos/{alertId}/media + a fetched
// Blob object URL, because the stream endpoint needs the raw Authorization
// header and cannot be an <audio src>.
//
// Runs the real app (Vite dev server) in headless Chrome against a mock backend
// on :3000 and checks, in order:
//   1. a viewer who has NOT pressed "I'm coming" makes no media request at all
//      (the backend would answer 403 — "responder terdaftar" only),
//   2. after POST /respond the list is read with the token, the stream is
//      fetched with the token, and the clip appears in a real <audio> whose src
//      is a blob: object URL (not a URL the player could not authenticate),
//   3. the transcript returned by the list is rendered with the player,
//   4. the sheet is opened from /?alert=<id>, the same path a push click takes.
//
// Run: npm run test:media   (needs Google Chrome; /usr/bin/google-chrome)

import http from 'node:http'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { createServer as createViteServer } from 'vite'

const API_PORT = 3000
const APP_PORT = 5173
const APP_URL = `http://localhost:${APP_PORT}`
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome'
const TOKEN = 'mock-session-token'
const ALERT_ID = 'alt_media_test'
const MEDIA_ID = 'med_media_test'
const TRANSCRIPT = 'tolong saya terjatuh di dapur'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---- a real, decodable 0.25 s silent WAV ------------------------------------
function silentWav(seconds = 0.25, rate = 8000) {
  const data = Buffer.alloc(Math.floor(seconds * rate) * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

const WAV = silentWav()

// ---- mock backend -----------------------------------------------------------
const requests = []

const send = (res, status, payload) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload ?? {}))
}

const incomingAlert = () => ({
  alert_id: ALERT_ID,
  status: 'TRIGGERED',
  emergency_type: 'MEDICAL',
  severity: 0.75,
  summary: 'Kemungkinan darurat medis',
  masked: true,
  triggered_at: Date.now() - 60_000,
  sender: { id: 'qa-neighbor', name: 'Neighbor' },
  latest_location: { latitude: -6.2, longitude: 106.8 },
})

const mediaRow = () => ({
  id: MEDIA_ID,
  alert_id: ALERT_ID,
  filename: 'sos-clip.wav',
  content_type: 'audio/wav',
  size_bytes: WAV.length,
  uploaded_at: Date.now() - 30_000,
  url: `/api/sos/${ALERT_ID}/media/${MEDIA_ID}`,
  transcript: TRANSCRIPT,
  transcription_status: 'completed',
  transcribed_at: Date.now() - 28_000,
})

const api = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Origin, Content-Type, Accept, Authorization, X-Idempotency-Key',
  )
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  const url = new URL(req.url, `http://localhost:${API_PORT}`)
  requests.push({
    method: req.method,
    pathname: url.pathname,
    search: url.search,
    auth: req.headers.authorization || null,
    at: Date.now(),
  })

  if (req.method === 'POST' && url.pathname === '/api/users/_login') {
    send(res, 200, { data: { token: TOKEN, id: 'qa-test', name: 'QA Test' } })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/users/_current') {
    send(res, 200, { data: { id: 'qa-test', name: 'QA Test' } })
    return
  }
  if (req.method === 'DELETE' && url.pathname === '/api/users') {
    send(res, 200, { data: {} })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/sos/active') {
    send(res, 200, { data: [] })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/sos/inbox') {
    send(res, 200, { data: [incomingAlert()] })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/location') {
    send(res, 200, {
      data: { user_id: 'qa-test', latitude: -6.2, longitude: 106.8, last_seen: Date.now(), stale: false },
    })
    return
  }
  if (req.method === 'PUT' && url.pathname === '/api/location') {
    send(res, 200, {
      data: { user_id: 'qa-test', latitude: -6.2, longitude: 106.8, last_seen: Date.now(), stale: false },
    })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/location/nearby') {
    send(res, 200, { data: { radius_m: 1000, count: 0, masked: true, responders: [] } })
    return
  }
  if (req.method === 'POST' && url.pathname === `/api/sos/${ALERT_ID}/respond`) {
    send(res, 200, { data: { eta_seconds: 180, victim_distance_meters: 240 } })
    return
  }
  if (req.method === 'GET' && url.pathname === `/api/sos/${ALERT_ID}/media`) {
    send(res, 200, { data: [mediaRow()] })
    return
  }
  if (req.method === 'GET' && url.pathname === `/api/sos/${ALERT_ID}/media/${MEDIA_ID}`) {
    if (req.headers.authorization !== TOKEN) {
      // Exactly what the real backend does without the raw token.
      send(res, 401, { errors: 'unauthorized' })
      return
    }
    res.statusCode = 200
    res.setHeader('Content-Type', 'audio/wav')
    res.setHeader('Content-Disposition', 'inline')
    res.end(WAV)
    return
  }
  if (req.method === 'GET' && url.pathname === `/api/sos/${ALERT_ID}`) {
    send(res, 200, { data: { ...incomingAlert(), masked: false, status: 'ACKNOWLEDGED' } })
    return
  }

  send(res, 200, { data: {} })
})

// ---- browser helpers --------------------------------------------------------

async function signIn(page) {
  await page.goto(`${APP_URL}/?alert=${ALERT_ID}`, { waitUntil: 'load' })
  await page.getByPlaceholder('e.g. khairul_bali').fill('qa-test')
  await page.locator('input[type="password"]').fill('secret123')
  await page.locator('form button[type="submit"]').click()
  await page.getByRole('button', { name: 'Profile', exact: true }).waitFor({ timeout: 15000 })
}

const mediaRequests = () =>
  requests.filter((r) => r.pathname.startsWith(`/api/sos/${ALERT_ID}/media`))
const mediaListRequests = () =>
  mediaRequests().filter((r) => r.pathname === `/api/sos/${ALERT_ID}/media`)
const mediaStreamRequests = () =>
  mediaRequests().filter((r) => r.pathname === `/api/sos/${ALERT_ID}/media/${MEDIA_ID}`)

function waitFor(predicate, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      const found = predicate()
      if (found) return resolve(found)
      if (Date.now() - started > timeout) return reject(new Error('Timed out'))
      setTimeout(tick, 25)
    }
    tick()
  })
}

// ---- main -------------------------------------------------------------------

let browser
let vite
try {
  await new Promise((resolve) => api.listen(API_PORT, resolve))

  process.env.VITE_API_URL = `http://localhost:${API_PORT}`
  process.env.VITE_WS_URL = `ws://localhost:${API_PORT}`
  vite = await createViteServer({
    logLevel: 'error',
    server: { port: APP_PORT, strictPort: true },
  })
  await vite.listen()

  browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  })

  const context = await browser.newContext({
    geolocation: { latitude: -6.2, longitude: 106.8 },
    permissions: ['geolocation'],
    serviceWorkers: 'block',
  })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (err) => pageErrors.push(err.message))

  await signIn(page)

  // 1. The push-style deep link opens the incoming sheet for this alert.
  await page.getByRole('button', { name: "I'm coming" }).waitFor({ timeout: 15000 })
  assert.equal(
    mediaListRequests().length,
    0,
    'a viewer who has not responded must not read media (the backend answers 403)',
  )
  console.log('ok 1 - no media request before POST /respond')

  // 2. Responding makes this viewer a participant, so the player may load.
  await page.getByRole('button', { name: "I'm coming" }).click()
  const list = await waitFor(() => mediaListRequests()[0])
  assert.equal(list.auth, TOKEN, 'the media list must carry the raw token')

  const audio = page.locator('audio')
  await audio.waitFor({ timeout: 15000 })
  const src = await audio.getAttribute('src')
  assert.ok(
    src?.startsWith('blob:'),
    `the player must use a blob: object URL, got ${src}`,
  )
  const stream = await waitFor(() => mediaStreamRequests().find((r) => r.auth === TOKEN))
  assert.ok(stream, 'the stream must be fetched with the Authorization header')
  // 3. Metadata decodes (real audio, not a broken blob) and the transcript sits
  // with the player.
  await page.waitForFunction(() => {
    const el = document.querySelector('audio')
    return el && el.readyState >= 1 && Number.isFinite(el.duration)
  }, { timeout: 15000 })
  const duration = await audio.evaluate((el) => el.duration)
  assert.ok(Math.abs(duration - 0.25) < 0.15, `decoded duration looks wrong: ${duration}`)
  await page.getByText(TRANSCRIPT).waitFor({ timeout: 5000 })

  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`)
  console.log('ok 2 - media is listed, streamed with the token and played from a blob URL')
  console.log('ok 3 - the transcript is shown next to the player')

  // 4. No second fetch of the same clip: the blob is cached for the sheet.
  await sleep(1500)
  assert.equal(mediaStreamRequests().length, 1, 'the clip must be fetched once per sheet')
  console.log('ok 4 - the clip is fetched once and reused for playback')

  await context.close()
  console.log('\nAll responder media checks passed.')
} finally {
  await browser?.close()
  await vite?.close()
  await new Promise((resolve) => api.close(resolve))
}
