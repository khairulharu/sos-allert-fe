// Web Push handler for SOS alerts. The backend sends
// {title, body, data:{alert_id, sender_id, emergency_type, latitude,
//  longitude, severity?, summary?, url}} encrypted with the VAPID key.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'SOS Alert', body: event.data ? event.data.text() : '' }
  }
  const data = payload.data || {}
  event.waitUntil(
    self.registration.showNotification(payload.title || 'SOS Alert', {
      body: payload.body || 'Emergency alert nearby.',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: data.alert_id || 'sos-alert',
      renotify: true,
      requireInteraction: true,
      data: { url: data.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  const payload = event.notification.data || {}
  const alertId = payload.alert_id || ''
  event.notification.close()

  // Carry the alert id to the app: an open window gets it as a message, a cold
  // start as ?alert=. Without it the first inbox poll can only show a banner, so
  // tapping the notification appeared to do nothing.
  const base = payload.url || '/'
  const url = alertId
    ? `${base}${base.includes('?') ? '&' : '?'}alert=${encodeURIComponent(alertId)}`
    : base

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of clients) {
        if ('focus' in client) {
          if (alertId && 'postMessage' in client) {
            client.postMessage({ type: 'sos-alert', alert_id: alertId })
          }
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    })(),
  )
})
