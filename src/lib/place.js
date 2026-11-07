// Reverse geocoding for the "you are here" label (Home header, Profile).
//
// Provider: Nominatim / OpenStreetMap — no API key and the same source as the
// map tiles in MapCard. The public instance allows light client-side use when
// answers are cached and lookups are throttled, so we snap coordinates to
// ~110 m (3 decimals, the same bucket the backend masks responder positions
// with) and keep the result in localStorage. See
// https://operations.osmfoundation.org/policies/nominatim/

const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse'
const CACHE_KEY = 'sos_alert_place_cache'
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const CACHE_MAX_ENTRIES = 40
const REQUEST_TIMEOUT_MS = 8000
const BUCKET_DECIMALS = 3

// Most specific name first, then the wider area people call "where I am".
const LOCAL_KEYS = ['suburb', 'village', 'neighbourhood', 'hamlet', 'quarter', 'city_block']
const AREA_KEYS = [
  'city_district',
  'county',
  'region',
  'municipality',
  'city',
  'state',
  'province',
]

let cache = readCache()
const inflight = new Map()

function readCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeCache() {
  try {
    const newest = Object.entries(cache)
      .sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0))
      .slice(0, CACHE_MAX_ENTRIES)
    cache = Object.fromEntries(newest)
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    /* storage disabled or full: the label still resolves for this session */
  }
}

function remember(latitude, longitude, label) {
  const key = placeKey(latitude, longitude)
  if (!key) return
  cache[key] = { label, at: Date.now() }
  writeCache()
}

// Coordinates are bucketed so a wandering heartbeat does not re-ask the
// provider for the same neighbourhood.
export function placeKey(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return `${latitude.toFixed(BUCKET_DECIMALS)},${longitude.toFixed(BUCKET_DECIMALS)}`
}

export function cachedPlace(latitude, longitude) {
  const key = placeKey(latitude, longitude)
  const hit = key ? cache[key] : null
  if (!hit?.label) return null
  if (Date.now() - (hit.at || 0) > CACHE_TTL_MS) return null
  return hit.label
}

// "Kuta, Badung", "Cipete Utara, Jakarta Selatan" — two parts fit the header pill.
export function formatPlace(address) {
  if (!address || typeof address !== 'object') return ''
  const pick = (keys) =>
    keys.map((key) => address[key]).find((value) => typeof value === 'string' && value.trim())
  const local = pick(LOCAL_KEYS)
  const area = pick(AREA_KEYS)
  if (local && area && local !== area) return `${local}, ${area}`
  return local || area || ''
}

function fallbackLabel(data) {
  const display = typeof data?.display_name === 'string' ? data.display_name : ''
  if (display) return display.split(',').slice(0, 2).join(',').trim()
  return typeof data?.name === 'string' ? data.name : ''
}

async function fetchPlace(latitude, longitude) {
  const url =
    `${ENDPOINT}?format=jsonv2&addressdetails=1&zoom=16&accept-language=id` +
    `&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    const data = await res.json()
    const label = formatPlace(data?.address) || fallbackLabel(data)
    if (!label) return null
    remember(latitude, longitude, label)
    return label
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// Resolves a human place name for the coordinates, or null when the provider
// is unreachable. Concurrent callers share one request per coordinate bucket.
export async function resolvePlace(latitude, longitude) {
  const key = placeKey(latitude, longitude)
  if (!key) return null
  const hit = cachedPlace(latitude, longitude)
  if (hit) return hit
  if (inflight.has(key)) return inflight.get(key)
  const task = fetchPlace(latitude, longitude).finally(() => inflight.delete(key))
  inflight.set(key, task)
  return task
}
