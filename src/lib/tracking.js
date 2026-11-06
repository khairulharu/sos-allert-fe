// Live SOS tracking over the backend WebSocket:
//   WS /ws/sos/:alertId/track?token=<raw session token>
//
// The server broadcasts LOCATION_UPDATE and ALERT_STATUS to the sender and
// confirmed responders. Only the sender may send breadcrumb frames.
import { writable, get } from 'svelte/store'
import { API_BASE_URL, getToken } from './api.js'

const WS_BASE = (
  import.meta.env.VITE_WS_URL || API_BASE_URL.replace(/^http/, 'ws')
).replace(/\/+$/, '')

const TERMINAL_STATUSES = new Set(['RESOLVED', 'CANCELLED', 'EXPIRED'])
const MAX_BACKOFF_MS = 15000
const MAX_QUEUE = 20

const EMPTY = {
  alertId: null,
  status: null,
  latitude: null,
  longitude: null,
  speedMps: null,
  headingDeg: null,
  updatedAt: null,
  connection: 'idle', // idle | connecting | open | reconnecting | closed | error
  lastError: '',
}

export const tracking = writable({ ...EMPTY })

let socket = null
let currentAlertId = null
let reconnectTimer = null
let attempts = 0
let stopped = true
let terminal = false
let queue = []

function patch(fields) {
  tracking.update((state) => ({ ...state, ...fields }))
}

function wsUrl(alertId) {
  const token = getToken() || ''
  return `${WS_BASE}/ws/sos/${encodeURIComponent(alertId)}/track?token=${encodeURIComponent(token)}`
}

function clearReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

function closeSocket() {
  clearReconnect()
  queue = []
  if (!socket) return
  socket.onopen = null
  socket.onmessage = null
  socket.onclose = null
  socket.onerror = null
  try {
    socket.close()
  } catch {
    /* already closing */
  }
  socket = null
}

function stopReconnecting() {
  terminal = true
  stopped = true
  clearReconnect()
  closeSocket()
}

function handleMessage(event) {
  let message
  try {
    message = JSON.parse(event.data)
  } catch {
    return
  }

  if (message?.error) {
    // Auth/authorization is rejected once; reconnecting cannot fix it.
    patch({ lastError: String(message.error), connection: 'error' })
    stopReconnecting()
    return
  }

  if (message?.type === 'LOCATION_UPDATE') {
    if (Number.isFinite(message.latitude) && Number.isFinite(message.longitude)) {
      patch({
        latitude: message.latitude,
        longitude: message.longitude,
        speedMps: message.speed_mps ?? null,
        headingDeg: message.heading_deg ?? null,
        updatedAt: Date.now(),
      })
    }
    return
  }

  if (message?.type === 'ALERT_STATUS') {
    patch({
      status: message.status ?? null,
      updatedAt: Number.isFinite(message.updated_at) ? message.updated_at : Date.now(),
    })
    if (TERMINAL_STATUSES.has(message.status)) {
      patch({ connection: 'closed' })
      stopReconnecting()
    }
  }
}

function scheduleReconnect() {
  if (stopped || terminal) return
  attempts += 1
  const delay = Math.min(1000 * 2 ** (attempts - 1), MAX_BACKOFF_MS)
  patch({ connection: 'reconnecting' })
  reconnectTimer = setTimeout(connect, delay)
}

function connect() {
  if (stopped || terminal || !currentAlertId) return
  if (typeof WebSocket === 'undefined') {
    patch({ connection: 'error', lastError: 'WebSocket is not supported in this browser.' })
    return
  }

  clearReconnect()
  patch({ connection: attempts === 0 ? 'connecting' : 'reconnecting' })

  let ws
  try {
    ws = new WebSocket(wsUrl(currentAlertId))
  } catch (err) {
    patch({ connection: 'error', lastError: err?.message || 'Could not open WebSocket.' })
    scheduleReconnect()
    return
  }
  socket = ws

  ws.onopen = () => {
    if (socket !== ws) return
    attempts = 0
    patch({ connection: 'open', lastError: '' })
    const pending = queue
    queue = []
    for (const payload of pending) ws.send(payload)
  }

  ws.onmessage = (event) => {
    if (socket === ws) handleMessage(event)
  }

  ws.onclose = () => {
    if (socket === ws) socket = null
    if (stopped || terminal) return
    scheduleReconnect()
  }

  ws.onerror = () => {
    if (socket === ws) patch({ lastError: 'Live connection lost.' })
  }
}

/**
 * Start (or switch) tracking for an alert. The optional seed avoids a gap
 * before the first server frame.
 */
export function startTracking(
  alertId,
  { status = null, latitude = null, longitude = null, updatedAt = null } = {},
) {
  if (!alertId) return
  if (currentAlertId === alertId && !stopped && !terminal) return

  closeSocket()
  currentAlertId = alertId
  attempts = 0
  stopped = false
  terminal = false
  queue = []
  tracking.set({
    ...EMPTY,
    alertId,
    status,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    updatedAt,
    connection: 'connecting',
  })
  connect()
}

/** Close the socket and clear the tracked alert. */
export function stopTracking() {
  stopped = true
  terminal = false
  currentAlertId = null
  attempts = 0
  closeSocket()
  tracking.set({ ...EMPTY })
}

/** Send one breadcrumb frame; queued until the socket is open. */
export function sendBreadcrumb(fields) {
  if (!fields || !Number.isFinite(fields.latitude) || !Number.isFinite(fields.longitude)) return
  if (stopped || terminal) return
  const payload = JSON.stringify({
    latitude: fields.latitude,
    longitude: fields.longitude,
    ...(Number.isFinite(fields.speed_mps) ? { speed_mps: fields.speed_mps } : {}),
    ...(Number.isFinite(fields.heading_deg) ? { heading_deg: fields.heading_deg } : {}),
    ...(Number.isFinite(fields.accuracy_meters) ? { accuracy_meters: fields.accuracy_meters } : {}),
    ...(Number.isFinite(fields.battery_percentage)
      ? { battery_percentage: fields.battery_percentage }
      : {}),
    timestamp: Date.now(),
  })

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(payload)
    return
  }
  if (socket && socket.readyState === WebSocket.CONNECTING && queue.length < MAX_QUEUE) {
    queue.push(payload)
  }
}

export function getTrackingState() {
  return get(tracking)
}

export { WS_BASE }
