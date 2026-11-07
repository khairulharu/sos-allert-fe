// API client for the SOS-Allert backend (Go service on :3000).
// Auth contract (see backend README): the raw session token goes in the
// Authorization header WITHOUT a "Bearer " prefix.
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000'

const TOKEN_KEY = 'sos_alert_token'
const USER_KEY = 'sos_alert_user'

let cachedToken = null

export function getToken() {
  if (cachedToken) return cachedToken
  cachedToken = localStorage.getItem(TOKEN_KEY)
  return cachedToken
}

export function setToken(token) {
  cachedToken = token || null
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

// The token this tab holds in memory — never the one in localStorage, which is
// shared with every other tab of this origin.
export function getSessionToken() {
  return cachedToken
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY))
  } catch {
    return null
  }
}

export function setStoredUser(user) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
  else localStorage.removeItem(USER_KEY)
}

function parseRetryAfter(value) {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds)
  const when = Date.parse(value)
  if (Number.isFinite(when)) return Math.max(0, Math.ceil((when - Date.now()) / 1000))
  return null
}

async function request(method, path, body, { token = true, raw = false, headers } = {}) {
  headers = headers || {}
  headers.Accept = 'application/json'
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData
  // Let the browser set the multipart boundary for FormData.
  if (body !== undefined && !isFormData) headers['Content-Type'] = 'application/json'
  if (token) {
    const t = getToken()
    if (t) headers.Authorization = t
  }

  let resp
  try {
    resp = await fetch(API_BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
    })
  } catch (err) {
    const e = new Error(`Network error — is the backend running at ${API_BASE}?`)
    e.cause = err
    throw e
  }

  let payload = null
  try {
    payload = await resp.json()
  } catch {
    /* non-JSON response (e.g. media stream) */
  }

  if (!resp.ok) {
    const detail =
      (payload && (payload.errors || payload.message)) ||
      (Array.isArray(payload?.errors) ? payload.errors.join(', ') : '') ||
      `HTTP ${resp.status}`
    const err = new Error(detail)
    err.status = resp.status
    err.payload = payload
    err.retryAfter = parseRetryAfter(resp.headers.get('Retry-After'))
    throw err
  }
  return raw ? resp : payload?.data
}

// ---- Auth ----
export const auth = {
  register: (id, password, name) =>
    request('POST', '/api/users', { id, password, name }),
  login: (id, password) => request('POST', '/api/users/_login', { id, password }),
  logout: (token) =>
    // `token: false` + an explicit header: the caller passes the session it owns
    // so a token another tab wrote in the meantime is never revoked by mistake.
    request('DELETE', '/api/users', undefined, {
      token: false,
      headers: token ? { Authorization: token } : {},
    }),
  current: () => request('GET', '/api/users/_current'),
  update: (fields) => request('PATCH', '/api/users/_current', fields),
}

// ---- Location heartbeat ----
export const location = {
  update: (latitude, longitude) => request('PUT', '/api/location', { latitude, longitude }),
  get: () => request('GET', '/api/location'),
  nearby: (radiusM = 1000) =>
    request('GET', `/api/location/nearby?radius_m=${encodeURIComponent(radiusM)}`),
}

// ---- SOS ----
export const sos = {
  trigger: (fields, idempotencyKey) =>
    request('POST', '/api/sos', fields, {
      headers: { 'X-Idempotency-Key': idempotencyKey || crypto?.randomUUID?.() || `sos-${Date.now()}-${Math.random().toString(36).slice(2)}` },
    }),
  // Pre-trigger audio classification: nothing is persisted, the caller is
  // expected to send `emergency_type`/`severity`/`summary` back in the trigger
  // body so the first fan-out already uses the audio level. `503` when STT is
  // not configured, `502` when the provider fails — both are meant to be
  // swallowed so the SOS still goes out on the description triage.
  classify: (blob, filename = 'sos-classify.webm') => {
    const form = new FormData()
    form.append('file', blob, filename)
    return request('POST', '/api/sos/classify', form)
  },
  active: () => request('GET', '/api/sos/active'),
  inbox: () => request('GET', '/api/sos/inbox'),
  get: (alertId) => request('GET', `/api/sos/${alertId}`),
  cancel: (alertId, pin, reason) =>
    request('POST', `/api/sos/${alertId}/cancel`, { pin, reason }),
  acknowledge: (alertId) => request('POST', `/api/sos/${alertId}/acknowledge`),
  resolve: (alertId) => request('POST', `/api/sos/${alertId}/resolve`),
  respond: (alertId, lat, lng) =>
    request('POST', `/api/sos/${alertId}/respond`, { responder_latitude: lat, responder_longitude: lng }),
  uploadMedia: (alertId, blob, filename = 'sos-audio.webm') => {
    const form = new FormData()
    form.append('file', blob, filename)
    return request('POST', `/api/sos/${encodeURIComponent(alertId)}/media`, form)
  },
}

// ---- Emergency contacts ----
export const contacts = {
  list: () => request('GET', '/api/emergency-contacts'),
  create: (fields) => request('POST', '/api/emergency-contacts', fields),
}

// ---- Browser push subscriptions ----
export const push = {
  publicKey: () => request('GET', '/api/push/vapid-public-key'),
  subscribe: (body) => request('POST', '/api/push/subscriptions', body),
  unsubscribe: (endpoint) => request('DELETE', '/api/push/subscriptions', { endpoint }),
  list: () => request('GET', '/api/push/subscriptions'),
}

export const API_BASE_URL = API_BASE
