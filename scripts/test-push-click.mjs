// Regression test for the push notification tap path.
//
// The service worker used to copy only `url` into the notification's `data`,
// while `notificationclick` reads `alert_id` from it. The backend sends
// `data.alert_id` (internal/usecase/webpush_notifier.go), so every tap arrived
// with an empty id: the app was focused and nothing else, and the inbox poll
// could only draw a banner a minute later. That is the "tapping the
// notification did nothing" report coming back.
//
// `public/sw.js` has no imports and only needs `self`, so it can be evaluated
// in a Node sandbox with a fake service-worker scope — no browser needed:
//   1. the notification carries `alert_id` (and keeps `url`),
//   2. clicking it on an open window posts `{type:'sos-alert', alert_id}`,
//   3. a cold start opens `/?alert=<id>`,
//   4. a payload without `alert_id` still opens the base url and posts nothing.
//
// Run: npm run test:push

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'public', 'sw.js'), 'utf8')

// The backend's buildPayload(): {title, body, data:{...fcm keys, url}}.
const ALERT_ID = 'alt_push_test'
const payload = {
  title: 'SOS Alert',
  body: 'Medical emergency nearby',
  data: {
    alert_id: ALERT_ID,
    sender_id: 'user-b',
    emergency_type: 'MEDICAL',
    latitude: '-6.2092',
    longitude: '106.8462',
    url: '/',
  },
}

function loadServiceWorker({ windows = 1 } = {}) {
  const handlers = {}
  const shown = []
  const posted = []
  const opened = []
  const self = {
    addEventListener: (type, handler) => (handlers[type] = handler),
    skipWaiting() {},
    clients: {
      claim() {},
      matchAll: async () =>
        Array.from({ length: windows }, () => ({
          focus: async () => {},
          postMessage: (message) => posted.push(message),
        })),
      openWindow: async (url) => opened.push(url),
    },
    registration: {
      showNotification: async (title, options) => shown.push({ title, options }),
    },
  }
  new Function('self', source)(self)
  return { handlers, shown, posted, opened }
}

// Runs a handler and waits for the promise it handed to event.waitUntil().
async function dispatch(handler, event) {
  let pending
  handler({ ...event, waitUntil: (promise) => (pending = promise) })
  await pending
}

async function push(sw, pushPayload = payload) {
  await dispatch(sw.handlers.push, {
    data: { json: () => pushPayload, text: () => '' },
  })
  return sw.shown.at(-1)
}

async function click(sw, notification) {
  await dispatch(sw.handlers.notificationclick, {
    notification: { data: notification.options.data, close() {} },
  })
}

// 1. The alert id survives showNotification().
{
  const sw = loadServiceWorker()
  const notification = await push(sw)
  assert.equal(notification.options.tag, ALERT_ID, 'the tag stays the alert id')
  assert.equal(notification.options.data.alert_id, ALERT_ID, 'alert_id reaches the notification')
  assert.equal(notification.options.data.url, '/', 'the url is kept')
  console.log('ok 1 - the notification carries data.alert_id and data.url')
}

// 2. Clicking it on an open window hands the alert id to the app.
{
  const sw = loadServiceWorker()
  await click(sw, await push(sw))
  assert.deepEqual(sw.posted, [{ type: 'sos-alert', alert_id: ALERT_ID }])
  assert.equal(sw.opened.length, 0, 'an existing window is focused, not duplicated')
  console.log('ok 2 - a tap on an open window posts {type:"sos-alert"} with the alert id')
}

// 3. Cold start: the url names the alert so the sheet opens on the first poll.
{
  const sw = loadServiceWorker({ windows: 0 })
  await click(sw, await push(sw))
  assert.deepEqual(sw.opened, [`/?alert=${encodeURIComponent(ALERT_ID)}`])
  assert.equal(sw.posted.length, 0, 'nothing to message without a window')
  console.log('ok 3 - a cold start opens /?alert=<id>')
}

// 4. A payload without an alert id still opens the app and posts nothing.
{
  const sw = loadServiceWorker({ windows: 0 })
  await click(sw, await push(sw, { title: 'SOS Alert', body: 'help', data: { url: '/' } }))
  assert.equal(sw.shown.at(-1).options.tag, 'sos-alert', 'the tag falls back to the generic one')
  assert.equal(sw.shown.at(-1).options.data.alert_id, '')
  assert.deepEqual(sw.opened, ['/'])
  console.log('ok 4 - a payload without alert_id opens the base url')
}

console.log('\nAll push notification click checks passed.')
