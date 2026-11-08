import { writable } from 'svelte/store'
import { auth, getSessionToken, getStoredUser, getToken, setStoredUser, setToken } from './api.js'

// Reactive session state shared across views.
export const session = writable({
  token: null,
  user: null,
  loading: false,
})

// Last AI triage result from a triggered SOS (shown in the alert flow).
export const lastTriage = writable(null)

// Profile → "Live location". Off means the app stops publishing the heartbeat,
// so the account really leaves nearby responder lists; a switch that only
// changed its own state would be a lie about a privacy control.
const SHARING_KEY = 'sos_alert_location_sharing'

function initialLocationSharing() {
  try {
    return localStorage.getItem(SHARING_KEY) !== 'off'
  } catch {
    return true
  }
}

export const locationSharing = writable(initialLocationSharing())

locationSharing.subscribe((on) => {
  try {
    localStorage.setItem(SHARING_KEY, on ? 'on' : 'off')
  } catch {
    /* private mode: the toggle still works for this session */
  }
})

// Reverse-geocoded "you are here" label for the current heartbeat, resolved by
// HomeView (src/lib/place.js) and reused by the Profile screen.
export const place = writable('')

// The backend login response contains {token} only (no id/name), so we
// fetch the full profile from /users/_current to populate the session.
async function hydrateUser(token) {
  setToken(token)
  try {
    const profile = await auth.current().catch(() => null)
    const stored = getStoredUser()
    const merged = { ...(stored || {}), ...(profile || {}) }
    if (!merged.name && stored?.name) merged.name = stored.name
    setStoredUser(merged)
    return merged
  } catch {
    const stored = getStoredUser()
    setStoredUser(stored)
    return stored
  }
}

export async function login(id, password) {
  session.update((s) => ({ ...s, loading: true }))
  try {
    const data = await auth.login(id, password)
    const token = data?.token || id
    setToken(token)
    const profile = await hydrateUser(token)
    const user = profile || { id, ...(data || {}) }
    session.set({ token, user, loading: false })
    return user
  } catch (err) {
    session.update((s) => ({ ...s, loading: false }))
    throw err
  }
}

export async function register(id, password, name) {
  session.update((s) => ({ ...s, loading: true }))
  try {
    // Store the display name so hydration can use it if the profile lacks it.
    setStoredUser({ id, name })
    await auth.register(id, password, name)
    // Backend does not return a token on register; log in right after.
    return await login(id, password)
  } catch (err) {
    session.update((s) => ({ ...s, loading: false }))
    throw err
  }
}

export async function logout() {
  // Revoke exactly the session this tab owns, and do it with a captured token:
  // localStorage is shared between tabs, so re-reading it after an await can
  // pick up a token another tab has just logged in with and delete that fresh
  // session instead (the account keeps a single token server-side).
  const token = getSessionToken()
  setToken(null)
  setStoredUser(null)
  session.set({ token: null, user: null, loading: false })
  if (!token) return
  try {
    await auth.logout(token)
  } catch (e) {
    /* ignore network errors on logout */
  }
}

export function restoreSession() {
  const user = getStoredUser()
  // The session token lives in its own localStorage key; the stored user
  // object is profile data and has no token. Never fall back to user.id:
  // that is not a session token and would make every authenticated call 401.
  const token = getToken()
  if (user && token) {
    setToken(token)
    session.set({ token, user, loading: false })
    return user
  }
  return null
}

export function setSessionUser(user) {
  setStoredUser(user)
  session.update((s) => ({ ...s, user }))
}
