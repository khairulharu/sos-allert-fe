// Browser Web Push registration (VAPID). The subscription is registered
// with the backend so SOS notifications reach this browser. Silent unless
// the permission is already granted; ProfileView is the only place that
// opens the permission prompt (it needs a user gesture).
import { push as pushApi, getToken } from './api.js'

export const PUSH_HELP = {
  insecure: 'Notifications need a secure connection. Open the app over https:// or on localhost.',
  unsupported: 'This browser cannot show push notifications.',
  denied: 'Notifications are blocked. Allow them for this site (padlock icon → Notifications → Allow).',
  error: 'Could not enable notifications. Try again.',
}

// 'insecure' | 'unsupported' | null
export function pushBlockReason() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported'
  if (window.isSecureContext === false) return 'insecure'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported'
  }
  return null
}

// 'granted' | 'denied' | 'default' | 'insecure' | 'unsupported'
export function pushPermissionState() {
  const blocked = pushBlockReason()
  if (blocked) return blocked
  return Notification.permission
}

function urlBase64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

function toBase64Url(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function registration() {
  return navigator.serviceWorker.register('/sw.js')
}

// Registers the current subscription with the backend. Returns
// { ok: true } or { ok: false, reason, message }.
export async function enablePush() {
  const blocked = pushBlockReason()
  if (blocked) return { ok: false, reason: blocked, message: PUSH_HELP[blocked] }
  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      return { ok: false, reason: 'denied', message: PUSH_HELP.denied }
    }
    const reg = await registration()
    await navigator.serviceWorker.ready
    const { public_key: publicKey } = await pushApi.publicKey()
    if (!publicKey) return { ok: false, reason: 'error', message: PUSH_HELP.error }
    let existing = await reg.pushManager.getSubscription()
    if (existing && reg.pushManager) {
      // A subscription created with a different VAPID key cannot be reused.
      const current = existing.options?.applicationServerKey
      if (current && toBase64Url(current) !== publicKey) {
        await existing.unsubscribe()
        existing = null
      }
    }
    const subscription =
      existing ||
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }))
    await pushApi.subscribe({
      endpoint: subscription.endpoint,
      p256dh: toBase64Url(subscription.getKey('p256dh')),
      auth: toBase64Url(subscription.getKey('auth')),
      user_agent: navigator.userAgent.slice(0, 255),
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err?.name === 'NotAllowedError' ? 'denied' : 'error', message: err?.message || PUSH_HELP.error }
  }
}

// Removes the backend record (best effort, needs a valid token) and the
// browser subscription, so a signed-out browser stops receiving alerts.
export async function disablePush() {
  if (pushBlockReason()) return
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
    const subscription = await reg?.pushManager?.getSubscription()
    if (!subscription) return
    if (getToken()) {
      await pushApi.unsubscribe(subscription.endpoint).catch(() => {})
    }
    await subscription.unsubscribe()
  } catch {
    /* signing out must never fail because of push cleanup */
  }
}

// Silent re-registration on login/restore: only when the permission is
// already granted, so no browser dialog appears unprompted.
export async function syncPushSubscription() {
  if (pushBlockReason()) return false
  if (Notification.permission !== 'granted') return false
  const res = await enablePush()
  return !!res.ok
}
