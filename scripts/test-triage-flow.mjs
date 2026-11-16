// Regression test for the triage card (#23, #54, #55).
//
// Runs the real app (Vite dev server) in headless Chrome against a mock backend
// on :3000 and checks, in order:
//   1. an empty classify answer on a retry does not keep the previous clip's
//      type or transcript, and no stale `emergency_type` is sent to the server,
//   2. `severity: 0` from the server is shown as a real Low / 1 km tier,
//   3. a trigger without a `triage` block shows "Classification unavailable"
//      instead of inventing Threat/danger.
//
// Each attempt pays the real 10 s countdown (it is the audio window).
//
// Run: npm run test:triage-flow   (needs Google Chrome; /usr/bin/google-chrome)

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

// Attempt 0: a real classification whose trigger fails.
// Attempt 1: a silent clip on retry, description triage wins.
// Attempt 2: a real type with severity 0 (the lowest legitimate score).
// Attempt 3: no triage at all.
const classifyResponses = [
  {
    emergency_type: 'MEDICAL',
    severity: 0.8,
    summary: 'Kemungkinan darurat medis',
    transcript: 'tolong saya jatuh',
    transcription_status: 'completed',
  },
  { emergency_type: '', severity: 0, transcription_status: 'empty' },
  {
    emergency_type: 'DANGER',
    severity: 0,
    summary: '',
    transcript: 'ada orang mengejar saya',
    transcription_status: 'completed',
  },
  { emergency_type: '', severity: 0, transcription_status: 'empty' },
]

const triggerResponses = [
  { status: 500, body: { errors: 'trigger failed' } },
  {
    status: 201,
    body: {
      data: {
        alert_id: 'alt_triage_1',
        status: 'TRIGGERED',
        grace_period_seconds: 0,
        recipients_notified: 2,
        triggered_at: Date.now(),
        triage: { emergency_type: 'ACCIDENT', severity: 0.5, summary: 'Kemungkinan kecelakaan' },
      },
    },
  },
  {
    status: 201,
    body: {
      data: {
        alert_id: 'alt_triage_2',
        status: 'TRIGGERED',
        grace_period_seconds: 0,
        recipients_notified: 1,
        triggered_at: Date.now(),
        triage: { emergency_type: 'DANGER', severity: 0 },
      },
    },
  },
  {
    status: 201,
    body: {
      data: {
        alert_id: 'alt_triage_3',
        status: 'TRIGGERED',
        grace_period_seconds: 0,
        recipients_notified: 0,
        triggered_at: Date.now(),
      },
    },
  },
]

const alertIds = ['alt_triage_0', 'alt_triage_1', 'alt_triage_2', 'alt_triage_3']
let attempt = -1
const triggerBodies = []
const requests = []

const send = (res, status, payload) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload ?? {}))
}

const detailFor = (id) => {
  const index = alertIds.indexOf(id)
  const trigger = triggerResponses[index]?.body?.data
  const triage = trigger?.triage
  return {
    alert_id: id,
    status: 'TRIGGERED',
    emergency_type: triage?.emergency_type || (index === 3 ? 'DANGER' : 'MEDICAL'),
    ...(Number.isFinite(triage?.severity) ? { severity: triage.severity } : {}),
    ...(triage?.summary ? { summary: triage.summary } : {}),
    masked: false,
    responders_en_route: 0,
    responders: [],
    triggered_at: Date.now(),
    sender: { id: 'qa-test', name: 'QA Test' },
    latest_location: { latitude: -6.2, longitude: 106.8, updated_at: Date.now() },
  }
}

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
    const raw = Buffer.concat(chunks).toString()
    requests.push({ method: req.method, pathname: url.pathname, raw })
    route(req, res, url, raw)
  })
})

function route(req, res, url, raw) {
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
  if (req.method === 'POST' && url.pathname === '/api/sos/classify') {
    attempt += 1
    send(res, 200, { data: classifyResponses[attempt] })
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/sos') {
    triggerBodies.push(raw)
    const response = triggerResponses[attempt]
    if (!response) {
      send(res, 500, { errors: `unexpected trigger attempt ${attempt}` })
      return
    }
    send(res, response.status, response.body)
    return
  }
  if (req.method === 'POST' && /^\/api\/sos\/[^/]+\/media$/.test(url.pathname)) {
    send(res, 200, {
      data: {
        id: `med_${attempt}`,
        alert_id: alertIds[attempt],
        filename: 'countdown.webm',
        content_type: 'audio/webm',
        size_bytes: 2048,
        uploaded_at: Date.now(),
        url: `/api/sos/${alertIds[attempt]}/media/med_${attempt}`,
        transcription_status: 'empty',
      },
    })
    return
  }
  if (req.method === 'POST' && /^\/api\/sos\/[^/]+\/resolve$/.test(url.pathname)) {
    const id = url.pathname.split('/')[3]
    send(res, 200, { data: { ...detailFor(id), status: 'RESOLVED', resolved_at: Date.now() } })
    return
  }
  if (req.method === 'GET' && /^\/api\/sos\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split('/')[3]
    send(res, 200, { data: detailFor(id) })
    return
  }
  if (url.pathname === '/api/location' || url.pathname === '/api/location/nearby') {
    send(res, 200, {
      data:
        url.pathname === '/api/location/nearby'
          ? { radius_m: 1000, count: 0, masked: true, responders: [] }
          : {
              user_id: 'qa-test',
              latitude: -6.2,
              longitude: 106.8,
              last_seen: Date.now(),
              stale: false,
            },
    })
    return
  }
  send(res, 200, { data: {} })
}

async function login(page) {
  await page.goto(`${APP_URL}/`, { waitUntil: 'load' })
  await page.getByPlaceholder('e.g. khairul_bali').fill('qa-test')
  await page.locator('input[type="password"]').fill('secret123')
  await page.locator('form button[type="submit"]').click()
  await page.getByRole('button', { name: 'Profile', exact: true }).waitFor({ timeout: 15000 })
}

async function holdSos(page) {
  const button = page.getByRole('button', { name: 'Hold to send SOS alert' })
  const box = await button.boundingBox()
  assert.ok(box, 'the SOS button must be on screen')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(1100) // the hold threshold is 850 ms
  await page.mouse.up()
}

async function startSos(page) {
  await holdSos(page)
  const description = page.getByPlaceholder('e.g. Someone collapsed at the beach and is unresponsive')
  await description.waitFor({ timeout: 15000 })
  if (!(await description.inputValue())) {
    await description.fill('Someone collapsed at the beach and is unresponsive')
  }
  await page.getByRole('button', { name: /Continue → Send SOS/ }).click()
}

async function endSos(page) {
  await page.getByRole('button', { name: /I'm safe — end alert/ }).click()
  await page.getByRole('button', { name: /Tap again to end alert/ }).click()
  await page.getByText("You're marked safe").waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: /Back to home/ }).click()
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
    permissions: ['geolocation', 'microphone'],
    serviceWorkers: 'block',
    viewport: MOBILE_VIEWPORT,
  })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (err) => pageErrors.push(err.message))

  await login(page)

  // 1. Attempt 0 classifies MEDICAL, the trigger fails; the retry classifies a
  // silent clip. Nothing from the first clip may survive.
  await startSos(page)
  await page.getByText('SOS could not be sent').waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: /Try again/ }).click()
  // The sheet is still open in the describe phase; the typed description is
  // preserved, so continue straight from there instead of holding the nav
  // button again (it is behind the modal).
  await page.getByRole('button', { name: /Continue → Send SOS/ }).click()
  await page.getByText('SOS active').waitFor({ timeout: 30000 })

  await page.getByText('No speech was recognized in the audio.').waitFor({ timeout: 15000 })
  assert.ok(await page.getByText('Accident', { exact: true }).isVisible(), 'description triage wins')
  assert.equal(
    await page.getByText('Medical emergency', { exact: true }).count(),
    0,
    'the previous clip type must not survive the retry',
  )
  assert.equal(
    await page.getByText('tolong saya jatuh').count(),
    0,
    'the previous clip transcript must not survive the retry',
  )
  assert.equal(
    await page.getByText('Threat / danger', { exact: true }).count(),
    0,
    'a silent clip must not become DANGER',
  )
  assert.equal(triggerBodies.length, 2)
  assert.ok(
    !triggerBodies[1].includes('emergency_type'),
    'the retry must not send the previous clip type to POST /api/sos',
  )
  console.log('ok 1 - a silent retry clears the old type/transcript and sends no stale type')

  // 2. severity 0 is a real lowest score and keeps the 1 km tier.
  await endSos(page)
  await startSos(page)
  await page.getByText('SOS active').waitFor({ timeout: 30000 })
  await page.getByText('Threat / danger', { exact: true }).waitFor({ timeout: 15000 })
  assert.ok(await page.getByText(/Low priority/).isVisible(), 'severity 0 renders as Low')
  assert.ok(await page.getByText(/closest responders \(1 km\)/).isVisible(), 'severity 0 keeps 1 km')
  console.log('ok 2 - severity 0 is displayed as a real Low / 1 km classification')

  // 3. No triage block at all: neutral state, no invented danger.
  await endSos(page)
  await startSos(page)
  await page.getByText('SOS active').waitFor({ timeout: 30000 })
  await page.getByText('Classification unavailable').waitFor({ timeout: 15000 })
  assert.equal(
    await page.getByText('Threat / danger', { exact: true }).count(),
    0,
    'an unclassified alert must not display DANGER',
  )
  assert.equal(
    await page.getByText('Severity', { exact: true }).count(),
    0,
    'an unclassified alert has no severity bar',
  )
  assert.ok(
    await page.getByText(/default 1 km/).isVisible(),
    'the radius copy falls back to the server default',
  )
  console.log('ok 3 - a missing triage block stays unclassified')

  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`)
  await context.close()
  console.log('\nAll triage flow checks passed.')
} finally {
  await browser?.close()
  await vite?.close()
  await new Promise((resolve) => api.close(resolve))
}
