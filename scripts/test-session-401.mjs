// Regression test for the single sign-out path on 401.
//
// Before this, only the inbox poller (every 12 s) and the nearby read treated a
// 401 as "session gone"; a view that failed on its own just rendered "couldn't
// load" and the app stayed signed in with a dead token. Now `api.js` reports
// every 401 that presented a session token, and `App.svelte` tears the session
// down exactly once.
//
// Runs the real app (Vite dev server) in headless Chrome against a mock backend
// on :3000 and checks, in order:
//   1. a wrong password (401 from /api/users/_login) does NOT end a session and
//      never calls DELETE /api/users — the client sent no token to expire,
//   2. a 401 from the Alerts view (history + summary) signs the user out, clears
//      the token and shows the "session ended" notice,
//   3. concurrent 401s (history, summary, inbox, nearby) still produce exactly
//      one DELETE: the teardown is re-entrant-safe.
//
// Run: npm run test:session   (needs Google Chrome; /usr/bin/google-chrome)

import http from 'node:http'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { createServer as createViteServer } from 'vite'
import { MOBILE_VIEWPORT } from './mobile-viewport.mjs'

const API_PORT = 3000
const APP_PORT = 5173
const APP_URL = `http://localhost:${APP_PORT}`
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome'
const TOKEN = 'mock-session-token'

let failViews = false // /api/sos/history + /api/sos/summary
let failAll = false // also inbox + every location read

const requests = []

const send = (res, status, payload) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload ?? {}))
}

const unauthorized = (res) => send(res, 401, { errors: 'unauthorized' })

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
  const body = []
  req.on('data', (chunk) => body.push(chunk))
  req.on('end', () => {
    const raw = Buffer.concat(body).toString()
    requests.push({
      method: req.method,
      pathname: url.pathname,
      auth: req.headers.authorization || null,
      body: raw,
    })
    route(req, res, url, raw)
  })
})

function route(req, res, url, raw) {
  if (req.method === 'POST' && url.pathname === '/api/users/_login') {
    const { password } = JSON.parse(raw || '{}')
    if (password !== 'secret123') {
      send(res, 401, { errors: 'invalid credentials' })
      return
    }
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
    if (failAll) return unauthorized(res)
    send(res, 200, { data: [] })
    return
  }
  if (req.method === 'GET' && (url.pathname === '/api/sos/history' || url.pathname === '/api/sos/summary')) {
    if (failViews || failAll) return unauthorized(res)
    if (url.pathname === '/api/sos/history') {
      send(res, 200, { data: [], paging: { page: 1, total_page: 1, total_item: 0 } })
    } else {
      send(res, 200, {
        data: {
          sent: { total: 0, active: 0, resolved: 0, cancelled: 0, expired: 0 },
          received: { total: 0, active: 0, resolved: 0, cancelled: 0, expired: 0 },
          responded: { total: 0, resolved: 0 },
        },
      })
    }
    return
  }
  if (url.pathname === '/api/location' || url.pathname === '/api/location/nearby') {
    if (failAll) return unauthorized(res)
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

const deleteCount = () =>
  requests.filter((r) => r.method === 'DELETE' && r.pathname === '/api/users').length
const historyCount = () => requests.filter((r) => r.pathname === '/api/sos/history').length

async function signIn(page, password = 'secret123') {
  await page.goto(`${APP_URL}/`, { waitUntil: 'load' })
  await page.getByPlaceholder('e.g. khairul_bali').fill('qa-test')
  await page.locator('input[type="password"]').fill(password)
  await page.locator('form button[type="submit"]').click()
}

async function waitForAuthScreen(page) {
  await page.getByPlaceholder('e.g. khairul_bali').waitFor({ timeout: 15000 })
}

async function openAlerts(page) {
  // Clicked from the page, not via Playwright's locator: the 401 teardown can
  // replace the shell mid-action, and the locator would then retry against a
  // nav that no longer exists.
  await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Main navigation"]')
    const button = [...nav.querySelectorAll('button')].find(
      (item) => item.textContent.trim() === 'Alerts',
    )
    button.click()
  })
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
    args: ['--no-sandbox'],
  })
  const context = await browser.newContext({
    geolocation: { latitude: -6.2, longitude: 106.8 },
    permissions: ['geolocation'],
    serviceWorkers: 'block',
    viewport: MOBILE_VIEWPORT,
  })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (err) => pageErrors.push(err.message))

  // 1. A failed login must not look like an expired session.
  await signIn(page, 'wrong-password')
  await page.getByRole('alert').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(500)
  assert.equal(deleteCount(), 0, 'a wrong password must never call DELETE /api/users')
  assert.equal(
    await page.evaluate(() => localStorage.getItem('sos_alert_token')),
    null,
    'no token is stored after a failed login',
  )
  await waitForAuthScreen(page)
  console.log('ok 1 - a failed login does not end a session or call DELETE')

  // 2. A 401 from the Alerts view signs out and says why.
  await signIn(page)
  await page.getByRole('button', { name: 'Profile', exact: true }).waitFor({ timeout: 15000 })
  failViews = true
  await openAlerts(page)
  await waitForAuthScreen(page)
  await page.getByText(/session ended/i).waitFor({ timeout: 5000 })
  assert.equal(deleteCount(), 1, 'the dead session is revoked exactly once')
  assert.equal(
    requests.find((r) => r.method === 'DELETE' && r.pathname === '/api/users')?.auth,
    TOKEN,
    'the revoke carries the raw token',
  )
  assert.equal(
    await page.evaluate(() => localStorage.getItem('sos_alert_token')),
    null,
    'the stored token is cleared',
  )
  console.log('ok 2 - a 401 from the Alerts view signs out once and shows the notice')

  // 3. Concurrent 401s still tear the session down only once.
  failViews = false
  failAll = false
  await signIn(page)
  await page.getByRole('button', { name: 'Profile', exact: true }).waitFor({ timeout: 15000 })
  const before = deleteCount()
  failAll = true
  await openAlerts(page)
  // Alerts (history + summary), the inbox poll and the nearby read now all 401.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await waitForAuthScreen(page)
  await page.waitForTimeout(1000)
  assert.ok(historyCount() > 0, 'the Alerts view really did hit the failing endpoint')
  assert.equal(deleteCount() - before, 1, 'four simultaneous 401s must not sign out four times')
  console.log('ok 3 - concurrent 401s produce exactly one teardown')

  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`)
  await context.close()
  console.log('\nAll session 401 checks passed.')
} finally {
  await browser?.close()
  await vite?.close()
  await new Promise((resolve) => api.close(resolve))
}
