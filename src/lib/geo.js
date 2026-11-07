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
import { get, writable } from 'svelte/store'
import { location as locationApi } from './api.js'
import { cachedPlace, resolvePlace } from './place.js'
import { place } from './stores.js'

export const NEARBY_RADIUS_M = 1000
const POLL_MS = 15000
// A fix younger than this is reused instead of asking the GPS again; the
// heartbeat (60 s) therefore acquires at most one fix per tick.
const FIX_MAX_AGE_MS = 45000

// Stored heartbeat (GET /api/location) the map center and header pill use.
export const own = writable(null)
export const responders = writable([])
export const nearbyRadius = writable(NEARBY_RADIUS_M)
export const nearbyLoading = writable(true)
export const nearbyError = writable('')

let timer = null
let visibilityHandler = null
let inFlight = null
let onSessionExpired = null

// Last known browser fix. Returned when a new acquisition fails, so a denied
// or slow GPS degrades to a slightly stale position instead of "no location".
let fix = null
let fixInFlight = null

export function browserPosition({ timeout = 6000, maxAge = FIX_MAX_AGE_MS } = {}) {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null)
  if (fix && Date.now() - fix.at < maxAge) return Promise.resolve(fix.coords)
  if (fixInFlight) return fixInFlight

  const task = new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        fix = { at: Date.now(), coords: { lat: pos.coords.latitude, lng: pos.coords.longitude } }
        resolve(fix.coords)
      },
      () => resolve(fix?.coords ?? null),
      { enableHighAccuracy: true, timeout, maximumAge: maxAge },
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

export async function refreshNearby() {
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const stored = (await readOwn()) || (await seedHeartbeat())
      if (stored) own.set(stored)

      if (!stored) {
        responders.set([])
        nearbyError.set('Waiting for a location heartbeat…')
        return
      }

      const data = await locationApi.nearby(get(nearbyRadius))
      responders.set(Array.isArray(data?.responders) ? data.responders : [])
      const radius = Number(data?.radius_m)
      if (Number.isFinite(radius) && radius > 0) nearbyRadius.set(radius)
      nearbyError.set('')
    } catch (err) {
      if (err?.status === 401) {
        const expired = onSessionExpired
        stopNearbyPolling()
        expired?.()
        return
      }
      nearbyError.set(err?.message || 'Could not load nearby responders.')
    } finally {
      nearbyLoading.set(false)
      inFlight = null
    }
  })()

  return inFlight
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
  nearbyError.set('')
  place.set('')
}
