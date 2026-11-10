// Regression test for issue #5: Home's radius control (1 km <-> 5 km) must not
// lose a tap to the 15 s nearby poll.
//
// The bug needs two things at the same time, so it only reproduces reliably
// with a real browser and a request frozen on purpose:
//   1. a nearby read for the OLD radius is still in flight when Layers is tapped
//      (the global in-flight guard then swallowed the new radius entirely), and
//   2. that old response lands afterwards (it used to write `radius_m` back into
//      `nearbyRadius`, undoing the tap).
//
// The mock backend holds one GET /api/location/nearby?radius_m=1000 until the
// test releases it, clicks the control, and then asserts:
//   - a request for radius_m=5000 was actually issued,
//   - the button reports aria-pressed="true" and the header says "5 km",
//   - the late 1 km answer did not revert the choice.
//
// Run: npm run test:radius   (needs Google Chrome; /usr/bin/google-chrome)

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
const requests = []
let holds = []

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
    radius: url.searchParams.get('radius_m'),
    auth: req.headers.authorization || null,
    at: Date.now(),
  }
  requests.push(entry)
  if (req.method === 'POST' || req.method === 'PUT') await readBody(req)

  const hold = findHold(req.method, url.pathname)
  if (hold) {
    hold.used = true
    hold.onArrive(entry)
    await hold.onReleased
  }

  if (req.method === 'POST' && url.pathname === '/api/users/_login') {
    send(res, 200, { data: { token: TOKEN, id: 'qa-test', name: 'QA Test' } })
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
    send(res, 200, { data: heartbeat() })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/location/nearby') {
    const radius = Number(url.searchParams.get('radius_m')) || 1000
    // Echo the requested radius, like the real backend.
    send(res, 200, { data: { radius_m: radius, count: 0, masked: true, responders: [] } })
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
  await page.getByRole('button', { name: 'Profile', exact: true }).waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: 'Home', exact: true }).click()
}

// The control's accessible name carries the intent of the NEXT tap.
const layers = (page) => page.locator('button[aria-label*="Search within"]')

async function buttonState(page) {
  const button = layers(page)
  return {
    label: await button.getAttribute('aria-label'),
    pressed: await button.getAttribute('aria-pressed'),
  }
}

// The header line that reports the count and the radius it searched.
async function headerLine(page) {
  return page.evaluate(() => {
    const match = document.body.innerText.match(/(None nearby|nearby|Checking…|Locating…)[^\n]*/)
    return match ? match[0].trim() : ''
  })
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

// ---- scenario ---------------------------------------------------------------

// A tap on Layers while the 1 km poll is frozen must still reach the backend and
// must survive the stale answer.
async function raceScenario() {
  requests.length = 0
  holds = []
  const context = await browser.newContext({
    geolocation: { latitude: -6.2, longitude: 106.8 },
    permissions: ['geolocation'],
    serviceWorkers: 'block',
  })
  const page = await context.newPage()
  try {
    // Freeze the very first nearby read: the 15 s poll that is already running
    // when the user taps the control.
    const frozen = holdOnce('GET', '/api/location/nearby')
    await signIn(page)
    const frozenRequest = await frozen.arrived
    assert.equal(frozenRequest.radius, '1000', 'the parked read must be the 1 km poll')

    const before = await buttonState(page)
    assert.equal(before.pressed, 'false', 'the control starts on the 1 km search')

    // The tap that used to be swallowed by `if (inFlight) return inFlight`.
    await layers(page).click()

    // Wait deterministically for the damage window: state must flip before the
    // stale answer is released, so this cannot pass on a lucky fast response.
    await page.waitForFunction(
      () =>
        document
          .querySelector('button[aria-label*="Search within"]')
          ?.getAttribute('aria-pressed') === 'true',
      { timeout: 5000 },
    )

    const wideRequest = await waitForRequest((r) => r.radius === '5000')
    assert.ok(wideRequest, 'a radius_m=5000 request must be issued')

    // Now let the stale 1 km answer land. It must not undo the choice.
    frozen.release()
    await sleep(1000)

    const after = await buttonState(page)
    assert.equal(after.pressed, 'true', `aria-pressed reverted: ${JSON.stringify(after)}`)
    assert.match(after.label, /1 km instead of 5 km/, `label reverted: ${after.label}`)

    const header = await headerLine(page)
    assert.match(header, /5 km/, `header must report the 5 km search, got "${header}"`)
    assert.doesNotMatch(header, /1 km/, `header reverted to 1 km: "${header}"`)
  } finally {
    await context.close()
  }
}

// Toggling back must work too, and the same-radius dedupe must not turn a
// second tap into a no-op.
async function toggleBackScenario() {
  requests.length = 0
  holds = []
  const context = await browser.newContext({
    geolocation: { latitude: -6.2, longitude: 106.8 },
    permissions: ['geolocation'],
    serviceWorkers: 'block',
  })
  const page = await context.newPage()
  try {
    await signIn(page)
    await waitForRequest((r) => r.radius === '1000')

    await layers(page).click()
    await waitForRequest((r) => r.radius === '5000')
    await page.waitForFunction(
      () =>
        document
          .querySelector('button[aria-label*="Search within"]')
          ?.getAttribute('aria-pressed') === 'true',
      { timeout: 5000 },
    )

    await layers(page).click()
    await page.waitForFunction(
      () =>
        document
          .querySelector('button[aria-label*="Search within"]')
          ?.getAttribute('aria-pressed') === 'false',
      { timeout: 5000 },
    )
    await sleep(600)

    const narrowRequests = requests.filter((r) => r.radius === '1000')
    assert.ok(
      narrowRequests.length >= 2,
      `toggling back must issue a new 1 km read (saw ${narrowRequests.length})`,
    )
    const after = await buttonState(page)
    assert.equal(after.pressed, 'false')
    const header = await headerLine(page)
    assert.match(header, /1 km/, `header must report the 1 km search, got "${header}"`)
  } finally {
    await context.close()
  }
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
    args: ['--no-sandbox'],
  })

  await raceScenario()
  console.log('ok 1 - a radius tap during a poll is sent and survives the stale answer')

  await toggleBackScenario()
  console.log('ok 2 - toggling back to 1 km issues a new read')

  console.log('\nAll radius toggle regression checks passed.')
} finally {
  await browser?.close()
  await vite?.close()
  await new Promise((resolve) => api.close(resolve))
}
