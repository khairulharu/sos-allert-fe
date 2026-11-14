// Regression test for ending an SOS when the resolve request fails.
//
// `doResolve()` used to swallow the error and switch to "You're marked safe"
// anyway: the backend alert stayed active (responders kept arriving, the live
// pin kept moving) while the screen claimed it had ended. The screen now stays
// on the active view, says what failed, and only shows the ended state once the
// server accepted the resolve.
//
// Runs the real app (Vite dev server) in headless Chrome against a mock backend
// on :3000 and checks, in order:
//   1. a failing POST /resolve leaves the active screen up with an error,
//   2. the error is retryable: a second two-tap attempt that succeeds reaches
//      the "You're marked safe" screen.
//
// Run: npm run test:resolve   (needs Google Chrome; /usr/bin/google-chrome)

import http from 'node:http'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { createServer as createViteServer } from 'vite'

const API_PORT = 3000
const APP_PORT = 5173
const APP_URL = `http://localhost:${APP_PORT}`
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome'
const TOKEN = 'mock-session-token'
const ALERT_ID = 'alt_resolve_test'

let failResolve = true
const requests = []

const send = (res, status, payload) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload ?? {}))
}

const alertDetail = () => ({
  alert_id: ALERT_ID,
  status: 'TRIGGERED',
  emergency_type: 'MEDICAL',
  severity: 0.72,
  summary: 'Kemungkinan darurat medis',
  masked: false,
  responders_en_route: 0,
  responders: [],
  triggered_at: Date.now(),
  sender: { id: 'qa-test', name: 'QA Test' },
  latest_location: { latitude: -6.2, longitude: 106.8, updated_at: Date.now() },
})

const api = http.createServer((req, res) => {
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
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    requests.push({
      method: req.method,
      pathname: url.pathname,
      raw: Buffer.concat(chunks).toString(),
    })
    route(req, res, url)
  })
})

function route(req, res, url) {
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
    send(res, 200, { data: [] })
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/sos') {
    send(res, 201, {
      data: {
        alert_id: ALERT_ID,
        status: 'TRIGGERED',
        grace_period_seconds: 5,
        recipients_notified: 2,
        triggered_at: Date.now(),
        triage: { emergency_type: 'MEDICAL', severity: 0.72, summary: 'Kemungkinan darurat medis' },
      },
    })
    return
  }
  if (req.method === 'GET' && url.pathname === `/api/sos/${ALERT_ID}`) {
    send(res, 200, { data: alertDetail() })
    return
  }
  if (req.method === 'POST' && url.pathname === `/api/sos/${ALERT_ID}/resolve`) {
    if (failResolve) {
      // What the client must never hide: the alert is still active.
      send(res, 500, { errors: 'resolve failed' })
      return
    }
    send(res, 200, { data: { ...alertDetail(), status: 'RESOLVED', resolved_at: Date.now() } })
    return
  }
  if (url.pathname === '/api/location' || url.pathname === '/api/location/nearby') {
    send(res, 200, {
      data:
        url.pathname === '/api/location/nearby'
          ? { radius_m: 1000, count: 0, masked: true, responders: [] }
          : { user_id: 'qa-test', latitude: -6.2, longitude: 106.8, last_seen: Date.now(), stale: false },
    })
    return
  }
  send(res, 200, { data: {} })
}

const resolveCalls = () =>
  requests.filter((r) => r.method === 'POST' && r.pathname === `/api/sos/${ALERT_ID}/resolve`)

async function holdSos(page) {
  const button = page.getByRole('button', { name: 'Hold to send SOS alert' })
  const box = await button.boundingBox()
  assert.ok(box, 'the SOS button must be on screen')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(1100) // the hold threshold is 850 ms
  await page.mouse.up()
}

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
    args: [
      '--no-sandbox',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  })
  const context = await browser.newContext({
    geolocation: { latitude: -6.2, longitude: 106.8 },
    permissions: ['geolocation'],
    serviceWorkers: 'block',
  })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (err) => pageErrors.push(err.message))

  await page.goto(`${APP_URL}/`, { waitUntil: 'load' })
  await page.getByPlaceholder('e.g. khairul_bali').fill('qa-test')
  await page.locator('input[type="password"]').fill('secret123')
  await page.locator('form button[type="submit"]').click()
  await page.getByRole('button', { name: 'Profile', exact: true }).waitFor({ timeout: 15000 })

  await holdSos(page)
  await page.getByPlaceholder('e.g. Someone collapsed at the beach and is unresponsive').waitFor({ timeout: 15000 })
  await page
    .getByPlaceholder('e.g. Someone collapsed at the beach and is unresponsive')
    .fill('Someone collapsed at the beach and is unresponsive')
  await page.getByRole('button', { name: /Continue → Send SOS/ }).click()

  // The countdown is the audio window; the alert goes out after 10 s.
  await page.getByText('SOS active').waitFor({ timeout: 30000 })
  assert.equal(resolveCalls().length, 0, 'nothing is resolved before the sender asks')

  // 1. A failing resolve must not claim the alert ended.
  await page.getByRole('button', { name: /I'm safe — end alert/ }).click()
  await page.getByRole('button', { name: /Tap again to end alert/ }).click()
  await page.getByText(/could not end the alert/i).waitFor({ timeout: 10000 })
  assert.equal(resolveCalls().length, 1, 'the retry is the user’s, not an automatic loop')
  assert.ok(
    await page.getByText('SOS active').isVisible(),
    'the active screen must stay up while the incident is still live',
  )
  console.log('ok 1 - a failed resolve keeps the active screen and reports the failure')

  // 2. Retrying after the server recovers really ends it.
  failResolve = false
  await page.getByRole('button', { name: /I'm safe — end alert/ }).click()
  await page.getByRole('button', { name: /Tap again to end alert/ }).click()
  await page.getByText("You're marked safe").waitFor({ timeout: 10000 })
  assert.equal(resolveCalls().length, 2, 'the second attempt reaches the backend once')
  console.log('ok 2 - a retry after recovery reaches the ended screen')

  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`)
  await context.close()
  console.log('\nAll resolve failure checks passed.')
} finally {
  await browser?.close()
  await vite?.close()
  await new Promise((resolve) => api.close(resolve))
}
