import { writable } from 'svelte/store'
import { auth, getStoredUser, setStoredUser, setToken } from './api.js'

// Reactive session state shared across views.
export const session = writable({
  token: null,
  user: null,
  loading: false,
})

// Last AI triage result from a triggered SOS (shown in the alert flow).
export const lastTriage = writable(null)

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
  try {
    await auth.logout()
  } catch (e) {
    /* ignore network errors on logout */
  }
  setToken(null)
  setStoredUser(null)
  session.set({ token: null, user: null, loading: false })
}

export function restoreSession() {
  const user = getStoredUser()
  if (user && (user.token || user.id)) {
    const token = user.token || user.id
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
