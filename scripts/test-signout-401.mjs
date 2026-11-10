// Regression test for issue #6: a sign-out must not leave a location request
// pointing at a session that is already gone.
//
// The real bug only shows up with a real browser, a real session and a request
// that is still in flight when Sign out is tapped, so this runs the actual app
// (Vite dev server) in headless Chrome against a small mock backend on :3000.
// The mock lets a request hang on purpose, so the race is deterministic instead
// of hoping a heartbeat tick lands at the wrong moment.
//
//   1. heartbeat path: sign out while PUT /api/location is in flight
//   2. nearby path:    sign out while GET /api/location (the readNearby chain)
//                      is in flight
//
// In both cases, after logout() there must be no /api/location* request without
// an Authorization header (and none at all, since the token is deleted before
// the sign-out completes). Before the fix, the PUT resolved into
// refreshNearbyNow() -> GET /api/location/nearby -> 401 auth=MISSING.
//
// Run: npm run test:signout   (needs Google Chrome; /usr/bin/google-chrome)

import http from 'node:http'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { createServer as createViteServer } from 'vite'

const API_PORT = 3000
const APP_PORT = 5173
const APP_URL = `http://localhost:${APP_PORT}`
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome'
const TOKEN = 'mock-session-token'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---- mock backend -----------------------------------------------------------
// Holds are one-shot gates: a matching request records its arrival, waits for
// release(), then answers normally. That is how the test freezes a request on
// the wire while the UI signs out.
const requests = []
const holds = []

function holdOnce(method, path) {
  let arrivedResolve
  const arrived = new Promise((resolve) => (arrivedResolve = resolve))
  let releaseResolve
  const released = new Promise((resolve) => (releaseResolve = resolve))
  const hold = { method, path, used: false, arrived, release: releaseResolve }
  holds.push(hold)
  hold.onArrive = arrivedResolve
  hold.onReleased = released
  return hold
}

function findHold(method, path) {
  return holds.find((h) => !h.used && h.method === method && h.path === path)
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => resolve(data))
  })
}

function send(res, status, payload) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload ?? {}))
}

const heartbeat = () => ({
  user_id: 'qa-test',
  latitude: -6.2,
  longitude: 106.8,
  last_seen: Date.now(),
  stale: false,
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
  const entry = {
    method: req.method,
    path: url.pathname + url.search,
    pathname: url.pathname,
    auth: req.headers.authorization || null,
    at: Date.now(),
  }
  requests.push(entry)
  const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : ''

  const hold = findHold(req.method, url.pathname)
  if (hold) {
    hold.used = true
    hold.onArrive(entry)
    await hold.onReleased
  }

  // CORS preflight never carries the token; everything else must. The mock
  // answers 401 like the real backend so a missing header is visible in the
  // request log instead of being silently accepted.
  if (req.method !== 'POST' && url.pathname !== '/api/users/_login' && !entry.auth) {
    send(res, 401, { errors: 'unauthorized' })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/users/_login') {
    send(res, 200, { data: { token: TOKEN, id: 'qa-test', name: 'QA Test' } })
    return
  }

  if (req.method === 'DELETE' && url.pathname === '/api/users') {
    send(res, 200, { data: {} })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/users/_current') {
    send(res, 200, { data: { id: 'qa-test', name: 'QA Test' } })
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

  if (req.method === 'GET' && url.pathname === '/api/location') {
    send(res, 200, { data: heartbeat() })
    return
  }

  if (req.method === 'PUT' && url.pathname === '/api/location') {
    send(res, 200, { data: { ...heartbeat(), payload: body } })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/location/nearby') {
    send(res, 200, { data: { radius_m: 1000, count: 0, masked: true, responders: [] } })
    return
  }

  send(res, 200, { data: {} })
})

// ---- browser helpers --------------------------------------------------------

async function signIn(page) {
  await page.goto(APP_URL, { waitUntil: 'load' })
  await page.getByPlaceholder('e.g. khairul_bali').fill('qa-test')
  await page.locator('input[type="password"]').fill('secret123')
  await page.locator('form button[type="submit"]').click()
  // The bottom nav only exists when the session gate is open.
  await page.getByRole('button', { name: 'Profile', exact: true }).waitFor({ timeout: 15000 })
}

async function signOutFromProfile(page) {
  await page.getByRole('button', { name: 'Profile', exact: true }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  // Back on the auth screen = logout() finished and the token is gone.
  await page.locator('form button[type="submit"]').waitFor({ timeout: 15000 })
}

function waitForRequest(predicate, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      const found = requests.find(predicate)
      if (found) return resolve(found)
      if (Date.now() - started > timeout) {
        return reject(new Error('Timed out waiting for request'))
      }
      setTimeout(tick, 25)
    }
    tick()
  })
}

function locationRequestsAfter(timestamp) {
  return requests.filter(
    (r) => r.at >= timestamp && r.pathname.startsWith('/api/location'),
  )
}

function resetLog() {
  requests.length = 0
  holds.length = 0
}

// One scenario = one fresh browser context (its own localStorage/session).
async function runScenario({ name, hold }) {
  resetLog()
  const context = await browser.newContext({
    geolocation: { latitude: -6.2, longitude: 106.8 },
    permissions: ['geolocation'],
    serviceWorkers: 'block',
  })
  const page = await context.newPage()
  try {
    const heldRequest = holdOnce(hold.method, hold.path)
    await signIn(page)
    const arrived = await heldRequest.arrived

    await signOutFromProfile(page)
    const deleteAt = (
      await waitForRequest((r) => r.method === 'DELETE' && r.pathname === '/api/users')
    ).at

    // Let the frozen request complete only now, exactly like a response that
    // lands after logout().
    heldRequest.release()
    await sleep(800)

    // Requests that were already on the wire when Sign out was tapped may
    // still be received (and carry the token they were sent with) — that is
    // normal. What must not happen is a *new* location request issued after
    // the token was deleted: it would arrive here with no Authorization and,
    // for the nearby chain, keep polling a dead session.
    const unauthenticated = requests.filter(
      (r) => r.pathname.startsWith('/api/location') && !r.auth,
    )
    assert.equal(
      unauthenticated.length,
      0,
      `${name}: request(s) without Authorization: ` +
        unauthenticated.map((r) => `${r.method} ${r.path}`).join(', '),
    )
    const nearbyAfter = locationRequestsAfter(deleteAt).filter(
      (r) => r.pathname === '/api/location/nearby',
    )
    assert.equal(
      nearbyAfter.length,
      0,
      `${name}: ${nearbyAfter.length} nearby request(s) after sign-out: ` +
        nearbyAfter.map((r) => `${r.method} ${r.path} auth=${r.auth || 'MISSING'}`).join(', '),
    )
    assert.ok(arrived.auth, `${name}: the held request itself must be authenticated`)
  } finally {
    await context.close()
  }
}

// ---- main -------------------------------------------------------------------

let browser
let vite
try {
  await new Promise((resolve) => api.listen(API_PORT, resolve))

  // The mock backend is the API base; the app is still served from :5173 so the
  // origin matches the real dev setup.
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

  await runScenario({
    name: 'heartbeat in flight',
    hold: { method: 'PUT', path: '/api/location' },
  })
  console.log('ok 1 - sign out while PUT /api/location is in flight leaves no location request')

  await runScenario({
    name: 'nearby chain in flight',
    hold: { method: 'GET', path: '/api/location' },
  })
  console.log('ok 2 - sign out while the nearby read is in flight leaves no location request')

  console.log('\nAll sign-out regression checks passed.')
} finally {
  await browser?.close()
  await vite?.close()
  await new Promise((resolve) => api.close(resolve))
}
