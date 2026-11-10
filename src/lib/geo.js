// Shared location state for the app shell.
//
// The heartbeat, the nearby-responder lookup, and the "you are here" label
// used to live inside HomeView, so every tab switch tore them down and re-ran
// a fresh browser geolocation fix plus three location requests. This module
// owns them once per session instead: views subscribe, App.svelte starts and
// stops polling with the session, and navigation touches neither the GPS nor
// the network.
//
// One source of truth for the browser fix: `browserPosition()` is the only
// place that asks the browser, remembers the last answer, and dedupes
// concurrent callers, so the heartbeat PUT, the map center, and the reverse
// geocoder cannot disagree by a coordinate bucket and make the label flip.
// `startPositionWatch()` keeps that answer live for the whole session; the
// pollers only read it.
import { get, writable } from 'svelte/store'
import { getSessionToken, location as locationApi } from './api.js'
import { cachedPlace, resolvePlace } from './place.js'
import { place } from './stores.js'

export const NEARBY_RADIUS_M = 1000
// The widest radius the backend accepts, and the tier the SOS fan-out can
// reach (adaptive radii 1/2/5 km). Home can switch to it so the header count
// matches who an alert would actually notify.
export const NEARBY_RADIUS_MAX_M = 5000
const POLL_MS = 15000
// A fix younger than this is reused. Older than this it is never returned:
// republishing an old coordinate with a fresh `last_seen` is what made a stale
// position look live in the responders' list.
const FIX_MAX_AGE_MS = 2 * 60 * 1000

// Stored heartbeat (GET /api/location) the map center and header pill use.
export const own = writable(null)
export const responders = writable([])
export const nearbyRadius = writable(NEARBY_RADIUS_M)
export const nearbyLoading = writable(true)
// `nearbyError` is the user-facing reason the list is empty; `nearbyReady` says
// whether an answer has ever arrived, so an empty list can be reported as
// "None nearby" instead of "Locating…".
export const nearbyError = writable('')
export const nearbyReady = writable(false)

let timer = null
let visibilityHandler = null
let inFlight = null
let onSessionExpired = null
// Session generation for nearby reads. `stopNearbyPolling()` bumps it so a
// chain that started before sign-out cannot continue with a missing token.
let nearbyEpoch = 0

// Last known browser fix. Kept even when it ages so callers can fall back to it
// once they know it is stale; `browserPosition()` never returns one that old.
let fix = null
let fixInFlight = null
let watchId = null

/** Newest fix from the continuous watch: { latitude, longitude, accuracy, at }. */
export const liveFix = writable(null)

function rememberFix(pos) {
  fix = {
    at: Date.now(),
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    // Metres; null when the browser cannot say. A coarse fix (WiFi/IP, no GPS)
    // can be kilometres off, so the map must show it as an area, not a point.
    accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
    speed: Number.isFinite(pos.coords.speed) ? pos.coords.speed : null,
    heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
  }
  liveFix.set(fix)
  return { lat: fix.latitude, lng: fix.longitude, accuracy: fix.accuracy }
}

// One continuous stream per session instead of a getCurrentPosition per
// consumer. `maximumAge: 0` refuses a cached fix, which is the difference
// between "moved 10 m" and "the provider still reports the old cell".
// Web geolocation cannot force GPS: `enableHighAccuracy` only asks for it, so a
// device without a GPS chip keeps reporting its network position (accuracy
// says how far off it may be).
export function startPositionWatch() {
  if (watchId != null || typeof navigator === 'undefined' || !navigator.geolocation) return
  watchId = navigator.geolocation.watchPosition(
    (pos) => rememberFix(pos),
    () => {}, // keep the last fix; its age and accuracy say how much to trust it
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
  )
}

export function stopPositionWatch() {
  if (watchId != null && typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId)
  }
  watchId = null
  fix = null
  liveFix.set(null)
}

export function browserPosition({ timeout = 8000, maxAge = FIX_MAX_AGE_MS } = {}) {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null)
  if (fix && Date.now() - fix.at <= maxAge) {
    return Promise.resolve({ lat: fix.latitude, lng: fix.longitude, accuracy: fix.accuracy })
  }
  if (fixInFlight) return fixInFlight

  const task = new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(rememberFix(pos)),
      // No fix is better than an old one reported as current.
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 0 },
    )
  })
  fixInFlight = task.finally(() => (fixInFlight = null))
  return fixInFlight
}

// Drives the header/Profile label off the heartbeat. A transient `own = null`
// (first paint after login) must not blank a label we already have.
let placeToken = 0
own.subscribe((value) => {
  const latitude = Number(value?.latitude)
  const longitude = Number(value?.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return

  const cached = cachedPlace(latitude, longitude)
  if (cached) {
    place.set(cached)
    return
  }
  const token = ++placeToken
  resolvePlace(latitude, longitude).then((label) => {
    if (token === placeToken && label) place.set(label)
  })
})

async function readOwn() {
  try {
    return await locationApi.get()
  } catch (err) {
    if (err.status === 401) throw err
    return null // 404: this account has never sent a heartbeat
  }
}

// No stored heartbeat yet: publish the browser fix once, then read it back.
async function seedHeartbeat() {
  const pos = await browserPosition()
  if (!pos) return null
  try {
    await locationApi.update(pos.lat, pos.lng)
  } catch (err) {
    if (err.status === 401) throw err
    return null
  }
  return await readOwn()
}

// A nearby read is a multi-step chain (own heartbeat -> maybe seed -> nearby).
// The session can end between those steps, so each hop checks that this read
// still belongs to the live session before issuing the next request or writing
// state. Without it, a read started under the old token fires the final
// /api/location/nearby with no Authorization header after sign-out (issue #6).
export async function refreshNearby() {
  const token = getSessionToken()
  // No session: never make an unauthenticated location request.
  if (!token) return
  if (inFlight) return inFlight

  const epoch = nearbyEpoch
  const current = () => epoch === nearbyEpoch && getSessionToken() === token

  const task = (async () => {
    try {
      let stored = await readOwn()
      if (!current()) return
      if (!stored) {
        stored = await seedHeartbeat()
        if (!current()) return
      }
      if (stored) own.set(stored)

      if (!stored) {
        // No heartbeat: nothing to search from. Say so instead of letting the
        // header claim there is nobody around.
        responders.set([])
        nearbyError.set('Location not shared yet')
        return
      }

      const data = await locationApi.nearby(get(nearbyRadius))
      if (!current()) return
      responders.set(Array.isArray(data?.responders) ? data.responders : [])
      const radius = Number(data?.radius_m)
      if (Number.isFinite(radius) && radius > 0) nearbyRadius.set(radius)
      nearbyError.set('')
    } catch (err) {
      // A 401 from a read the session already ended is not news: the sign-out
      // path has cleared the stores, and onSessionExpired no longer belongs to
      // this epoch (it would be a no-op anyway).
      if (!current()) return
      if (err?.status === 401) {
        const expired = onSessionExpired
        stopNearbyPolling()
        expired?.()
        return
      }
      if (err?.status === 404) {
        // The backend answers 404 when the caller itself has no heartbeat.
        responders.set([])
        nearbyError.set('Location not shared yet')
        return
      }
      nearbyError.set(err?.message || 'Could not load nearby responders.')
    } finally {
      // stopNearbyPolling() bumps the epoch and drops inFlight; a late chain
      // must not clear the flag of a newer one or overwrite its loading state.
      if (current()) {
        nearbyLoading.set(false)
        nearbyReady.set(true)
      }
      if (inFlight === task) inFlight = null
    }
  })()

  inFlight = task
  return task
}

// Home's radius control: the search radius really changes, so the circle on the
// map and the "N nearby" count describe the same search.
export function setNearbyRadius(meters) {
  const radius = Math.round(Number(meters))
  if (!Number.isFinite(radius) || radius < 100 || radius > NEARBY_RADIUS_MAX_M) return
  if (get(nearbyRadius) === radius) return
  nearbyRadius.set(radius)
  // A new radius is a new answer: show it as loading, not as an empty list.
  nearbyLoading.set(true)
  refreshNearby()
}

// Called after this device published a heartbeat: its own freshness is what
// makes it visible to others, and the answer is worth re-reading immediately
// instead of on the next 15 s tick.
export function refreshNearbyNow() {
  return refreshNearby()
}

export function startNearbyPolling(options = {}) {
  if (typeof options.onSessionExpired === 'function') onSessionExpired = options.onSessionExpired
  if (timer) return

  refreshNearby()
  timer = setInterval(() => {
    if (!document.hidden) refreshNearby()
  }, POLL_MS)

  // Returning to the tab after a while should not wait for the next tick.
  visibilityHandler = () => {
    if (!document.hidden) refreshNearby()
  }
  document.addEventListener('visibilitychange', visibilityHandler)
}

export function stopNearbyPolling() {
  // Invalidate reads already in flight: they may be sitting on an await and
  // would otherwise proceed with the token the sign-out is about to delete.
  nearbyEpoch++
  clearInterval(timer)
  timer = null
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler)
    visibilityHandler = null
  }
  onSessionExpired = null
  inFlight = null
  own.set(null)
  responders.set([])
  nearbyRadius.set(NEARBY_RADIUS_M)
  nearbyLoading.set(true)
  nearbyReady.set(false)
  nearbyError.set('')
  place.set('')
}
