<script>
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { fly } from 'svelte/transition'
  import BottomNav from '$lib/components/BottomNav.svelte'
  import HomeView from '$lib/components/HomeView.svelte'
  import AlertsView from '$lib/components/AlertsView.svelte'
  import ContactsView from '$lib/components/ContactsView.svelte'
  import ProfileView from '$lib/components/ProfileView.svelte'
  import AlertFlow from '$lib/components/AlertFlow.svelte'
  import AlertIncoming from '$lib/components/AlertIncoming.svelte'
  import AuthScreen from '$lib/components/AuthScreen.svelte'
  import { session, restoreSession, logout, locationSharing } from '$lib/stores.js'
  import { location as locationApi, sos as sosApi, getSessionToken } from '$lib/api.js'
  import {
    tracking,
    responderTracking,
    startTracking,
    stopTracking,
    startResponderTracking,
    stopResponderTracking,
  } from '$lib/tracking.js'
  import { formatDistance, formatEta } from '$lib/alertMeta.js'
  import { micPermissionState, requestMicAccess } from '$lib/mic.js'
  import { browserPosition, startNearbyPolling, stopNearbyPolling } from '$lib/geo.js'
  import { syncPushSubscription, disablePush } from '$lib/push.js'

  let tab = $state('home')
  let sosOpen = $state(false)
  let incomingOpen = $state(false)
  let pendingAlert = $state(null)
  // Set once the user answered the alert in the sheet: the sheet stays open as
  // the responder's live view for that alert.
  let respondedAlert = $state(null)
  // Alert id carried by a tapped push notification (?alert= on a cold start, or
  // a service-worker message while the app is open).
  let focusAlertId = $state(null)
  let responding = $state(false)
  let respondError = $state('')
  let toast = $state('')
  let toastTimer
  let scrollEl = $state(null)
  let inboxTimer
  let inboxPolling = false
  let inboxInitialised = false
  const dismissedAlerts = new Set()

  // Set when a 401 ends the session so the auth screen can say why the user is
  // back here instead of leaving it a mystery.
  let authNotice = $state('')

  // Session gate: authenticated state.
  let authed = $state(false)
  let currentUser = $state(null)

  onMount(() => {
    // Arriving from a notification tap: the service worker appends the alert id
    // so the matching sheet opens instead of a bare banner. Clean the URL after.
    const wanted = new URLSearchParams(location.search).get('alert')
    if (wanted) {
      focusAlertId = wanted
      history.replaceState({}, '', location.pathname + location.hash)
    }
    const restored = restoreSession()
    if (restored) {
      authed = true
      currentUser = restored
      startLocationHeartbeat()
      primeMicrophone()
      syncActiveTracking()
      startInboxPolling()
      startNearbyPolling({ onSessionExpired })
      syncPushSubscription().catch(() => {})
    }
  })

  // Keep an eye on store so logout trips the gate.
  session.subscribe((s) => {
    authed = !!s.token && !!s.user
    if (s.user) currentUser = s.user
  })

  // ---- live SOS tracking (WebSocket) ----
  let liveTrack = $state({ alertId: null, status: null, connection: 'idle' })
  let trackedAlertId = null
  let trackedStatus = null

  const TERMINAL = new Set(['RESOLVED', 'CANCELLED', 'EXPIRED'])

  tracking.subscribe((value) => {
    const sameAlert = value.alertId && value.alertId === trackedAlertId
    if (sameAlert && value.status && value.status !== trackedStatus && TERMINAL.has(value.status) && !sosOpen) {
      notify(
        value.status === 'RESOLVED'
          ? 'Your SOS was resolved. Live tracking stopped.'
          : value.status === 'CANCELLED'
            ? 'Your SOS was cancelled. Live tracking stopped.'
            : 'Your SOS expired. Live tracking stopped.',
      )
    }
    if (value.alertId !== trackedAlertId) trackedStatus = null
    if (value.status) trackedStatus = value.status
    trackedAlertId = value.alertId
    liveTrack = value
  })

  // Responder-side stream for an alert this user answered.
  let responderTrack = $state({ alertId: null, status: null, connection: 'idle' })
  let responderTrackedId = null
  let responderTrackedStatus = null

  responderTracking.subscribe((value) => {
    const sameAlert = value.alertId && value.alertId === responderTrackedId
    if (
      sameAlert &&
      value.status &&
      value.status !== responderTrackedStatus &&
      TERMINAL.has(value.status)
    ) {
      notify(
        value.status === 'RESOLVED'
          ? 'The nearby SOS was resolved.'
          : value.status === 'CANCELLED'
            ? 'The nearby SOS was cancelled.'
            : 'The nearby SOS expired.',
      )
      // Nothing left to watch: drop the responder's live sheet with it.
      if (respondedAlert && respondedAlert.alert_id === value.alertId) {
        incomingOpen = false
        pendingAlert = null
        respondedAlert = null
      }
    }
    if (value.alertId !== responderTrackedId) responderTrackedStatus = null
    if (value.status) responderTrackedStatus = value.status
    responderTrackedId = value.alertId
    responderTrack = value
  })

  // Prefer the user's own active alert; otherwise show the victim they
  // are responding to.
  const mapLive = $derived(
    liveTrack.alertId && !TERMINAL.has(liveTrack.status) ? liveTrack : responderTrack,
  )

  // Cold start / login: resume tracking for an active alert owned by this user.
  async function syncActiveTracking() {
    try {
      const active = await sosApi.active()
      const alert = Array.isArray(active) ? active[0] : null
      if (!alert?.alert_id) return
      const latest = alert.latest_location || alert.initial_location || {}
      startTracking(alert.alert_id, {
        status: alert.status,
        latitude: latest.latitude,
        longitude: latest.longitude,
        updatedAt: latest.updated_at ?? alert.triggered_at ?? null,
      })
    } catch {
      /* best-effort: nearby polling and the rest of the app keep working */
    }
  }

  function handleTrack(alertId, seed) {
    startTracking(alertId, seed)
  }

  // ---- incoming responder alerts (inbox polling) ----
  const INBOX_POLL_MS = 12000

  async function pollInbox() {
    if (inboxPolling || !currentUser) return
    inboxPolling = true
    try {
      const data = await sosApi.inbox()
      const list = Array.isArray(data) ? data : []
      const me = currentUser?.id
      const active = list
        .filter(
          (alert) =>
            alert?.alert_id &&
            (alert.status === 'TRIGGERED' || alert.status === 'ACKNOWLEDGED'),
        )
        .filter((alert) => (alert.sender?.id || alert.sender_id) !== me)
        .sort(
          (a, b) => (Number(b.triggered_at) || 0) - (Number(a.triggered_at) || 0),
        )

      // `masked !== true` means the caller is already a participant
      // (sender is filtered above), so don't offer it as a new incoming alert.
      const visible = active.filter(
        (alert) => alert.masked === true && !dismissedAlerts.has(alert.alert_id),
      )
      const newest = visible[0] || null
      const current =
        (pendingAlert && visible.find((alert) => alert.alert_id === pendingAlert.alert_id)) ||
        null

      // A tapped push notification names its alert: open that sheet straight
      // away, even on a cold start where the first poll would only show a banner.
      const pushed = focusAlertId
        ? active.find((alert) => alert.alert_id === focusAlertId) || null
        : null
      focusAlertId = null

      if (pushed) {
        dismissedAlerts.delete(pushed.alert_id)
        pendingAlert = pushed
        incomingOpen = true
        respondError = ''
        inboxInitialised = true
      } else if (incomingOpen && current) {
        // Keep the sheet stable while the user is reading it.
        pendingAlert = current
      } else if (
        incomingOpen &&
        respondedAlert &&
        pendingAlert?.alert_id === respondedAlert.alert_id
      ) {
        // Already answered: the alert drops out of `visible` (the caller is a
        // participant now), but the sheet stays up as the live view.
      } else {
        const changed = newest?.alert_id !== pendingAlert?.alert_id
        pendingAlert = newest
        if (!newest) {
          incomingOpen = false
          respondError = ''
        } else if (changed && !incomingOpen && !sosOpen && inboxInitialised) {
          incomingOpen = true
          respondError = ''
        }
      }
      inboxInitialised = true

      // Resume a read-only stream for an alert we already responded to.
      if (!responderTrack.alertId || TERMINAL.has(responderTrack.status)) {
        const participated = active.find((alert) => alert.masked !== true)
        if (participated) {
          const loc = participated.latest_location || participated.initial_location || {}
          startResponderTracking(participated.alert_id, {
            status: participated.status,
            latitude: loc.latitude,
            longitude: loc.longitude,
            updatedAt: loc.updated_at ?? participated.triggered_at ?? null,
          })
        }
      }
    } catch (err) {
      if (err?.status === 401) onSessionExpired()
    } finally {
      inboxPolling = false
    }
  }

  // Returning to the tab (e.g. after clicking a push notification) surfaces a
  // fresh alert without waiting for the next tick. The service worker also names
  // the alert the user tapped, so its sheet opens rather than just a banner.
  function onVisibilityChange() {
    if (!document.hidden) pollInbox()
  }

  function onServiceWorkerMessage(event) {
    if (event.data?.type !== 'sos-alert') return
    focusAlertId = event.data.alert_id || null
    if (focusAlertId) pollInbox()
  }

  function startInboxPolling() {
    if (inboxTimer) return
    pollInbox()
    inboxTimer = setInterval(() => {
      if (!document.hidden) pollInbox()
    }, INBOX_POLL_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
    navigator.serviceWorker?.addEventListener('message', onServiceWorkerMessage)
  }

  function stopInboxPolling() {
    clearInterval(inboxTimer)
    inboxTimer = null
    document.removeEventListener('visibilitychange', onVisibilityChange)
    navigator.serviceWorker?.removeEventListener('message', onServiceWorkerMessage)
    inboxPolling = false
    inboxInitialised = false
    focusAlertId = null
    pendingAlert = null
    respondedAlert = null
    incomingOpen = false
    respondError = ''
    responding = false
    dismissedAlerts.clear()
    stopResponderTracking()
  }

  function dismissIncoming() {
    if (pendingAlert?.alert_id) dismissedAlerts.add(pendingAlert.alert_id)
    incomingOpen = false
    pendingAlert = null
    respondedAlert = null
    respondError = ''
  }

  async function responseCoords() {
    const pos = await browserPosition()
    if (pos) return pos
    try {
      const stored = await locationApi.get()
      if (stored) return { lat: stored.latitude, lng: stored.longitude }
    } catch {
      /* fall through to the heartbeat fallback */
    }
    return { lat: lastCoord.lat, lng: lastCoord.lng }
  }

  async function respondToAlert() {
    const alert = pendingAlert
    if (!alert?.alert_id || responding) return
    if (alert.masked !== true) {
      dismissedAlerts.add(alert.alert_id)
      dismissIncoming()
      notify('You already responded to that alert.')
      return
    }
    responding = true
    respondError = ''
    try {
      const pos = await responseCoords()
      const result = await sosApi.respond(alert.alert_id, pos.lat, pos.lng)

      dismissedAlerts.add(alert.alert_id)
      // Keep the sheet open: the responder now has a live stream for this alert
      // (responderTracking), so it is the only place that can show a
      // re-classification, the moving pin and the terminal state.
      const eta = formatEta(Number(result?.eta_seconds))
      const distance = formatDistance(Number(result?.victim_distance_meters))
      respondedAlert = { alert_id: alert.alert_id, eta, distance }

      notify(
        ["You're on the way", eta ? `ETA ${eta}` : '', distance ? `${distance} away` : '']
          .filter(Boolean)
          .join(' · ') + '.',
      )

      const loc = alert.latest_location || alert.initial_location || {}
      startResponderTracking(alert.alert_id, {
        status: 'ACKNOWLEDGED',
        latitude: loc.latitude,
        longitude: loc.longitude,
        updatedAt: Date.now(),
      })
    } catch (err) {
      if (err?.status === 409) {
        dismissedAlerts.add(alert.alert_id)
        respondError = 'You already responded to this alert.'
      } else if (err?.status === 404) {
        dismissedAlerts.add(alert.alert_id)
        incomingOpen = false
        pendingAlert = null
        notify('That alert is no longer available.')
      } else {
        respondError = err?.message || 'Could not send your response.'
      }
    } finally {
      responding = false
    }
  }

  // A dialog owns the screen: everything behind it is made inert so the only
  // reachable controls are the dialog's own.
  const modalOpen = $derived(sosOpen || (incomingOpen && !!pendingAlert))

  // ---- geolocation + heartbeat ----
  let heartbeatTimer
  let lastCoord = $state({ lat: -8.65, lng: 115.22 })

  // One shared browser fix (src/lib/geo.js) feeds both the heartbeat and the
  // nearby map, so the two writers can never publish different buckets, and the
  // GPS is asked at most once per tick instead of on every view mount.
  async function publishHeartbeat() {
    const pos = await browserPosition()
    if (pos) lastCoord = pos
    // Profile → "Live location". With sharing off nothing is published, so the
    // account drops out of nearby lists as soon as last_seen goes stale.
    if (!get(locationSharing)) return
    try {
      await locationApi.update(lastCoord.lat, lastCoord.lng)
    } catch {
      /* heartbeat failures are safe to ignore */
    }
  }

  let sharingUnsub = null
  let sharingWasOn = false

  function startLocationHeartbeat() {
    if (heartbeatTimer) return
    publishHeartbeat()
    heartbeatTimer = setInterval(publishHeartbeat, 60000)
    // Turning sharing back on publishes at once instead of waiting a tick.
    sharingWasOn = get(locationSharing)
    sharingUnsub = locationSharing.subscribe((on) => {
      if (on && !sharingWasOn) publishHeartbeat()
      sharingWasOn = on
    })
  }

  function stopLocationHeartbeat() {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
    sharingUnsub?.()
    sharingUnsub = null
  }

  // Microphone access is requested in the same breath as the location one, so
  // a first-time browser dialog never lands in the middle of an SOS. Silent by
  // design: a refusal is explained on the SOS screen, not as a toast.
  let micPrimed = false
  async function primeMicrophone() {
    if (micPrimed) return
    micPrimed = true
    const state = await micPermissionState()
    if (state === 'prompt' || state === 'unknown') await requestMicAccess()
  }

  function notify(message) {
    toast = message
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toast = ''), 2800)
  }

  function navigate(next) {
    tab = next
    requestAnimationFrame(() => scrollEl?.scrollTo({ top: 0, behavior: 'smooth' }))
  }

  function onAuthSuccess() {
    authNotice = ''
    const s = restoreSession()
    if (s) {
      authed = true
      currentUser = s
      startLocationHeartbeat()
      primeMicrophone()
      syncActiveTracking()
      startInboxPolling()
      startNearbyPolling({ onSessionExpired })
      syncPushSubscription().catch(() => {})
    }
  }

  async function onSignOut() {
    authNotice = ''
    // The server-side delete needs a valid token, and logout() revokes it.
    await disablePush()
    stopInboxPolling()
    stopNearbyPolling()
    stopLocationHeartbeat()
    stopTracking()
    await logout()
    currentUser = null
    tab = 'home'
  }

  async function onSessionExpired() {
    // A 401 for a session this tab already ended must not run again: it would
    // revoke whatever token another tab has logged in with since, and claim the
    // user was signed out when they were not.
    if (!getSessionToken()) return
    // The server no longer accepts this token: it was revoked by a sign-out or
    // replaced by another login (the account keeps one token server-side).
    authNotice = 'Your session ended — sign in again to keep getting SOS alerts.'
    // The token is already dead, so the DELETE 401s and the subscription is
    // cleaned up by the backend once the push service reports it gone (410).
    await disablePush()
    stopInboxPolling()
    stopNearbyPolling()
    stopLocationHeartbeat()
    stopTracking()
    await logout()
    currentUser = null
  }
</script>

<svelte:head>
  <meta name="description" content="SOS Alert — a community safety app that gets help to you in seconds." />
</svelte:head>

{#if !authed}
  <AuthScreen onsuccess={onAuthSuccess} notice={authNotice} />
{:else}
  <div class="relative flex min-h-dvh w-full items-center justify-center overflow-hidden bg-[#E7E9ED]">
    <!-- ambient backdrop -->
    <div class="pointer-events-none absolute inset-0 hidden sm:block">
      <div class="absolute left-1/2 top-1/2 h-[760px] w-[760px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/60 blur-3xl"></div>
      <div class="absolute -left-24 top-10 h-80 w-80 rounded-full bg-[#FF3B30]/10 blur-3xl"></div>
      <div class="absolute -right-20 bottom-0 h-96 w-96 rounded-full bg-[#2F6BFF]/10 blur-3xl"></div>
    </div>

    <!-- app shell -->
    <div
      class="relative z-10 flex h-dvh w-full max-w-[430px] flex-col overflow-hidden bg-canvas sm:h-[min(884px,calc(100dvh_-_32px))] sm:rounded-[44px] sm:ring-1 sm:ring-black/10 sm:shadow-[0_50px_120px_-40px_rgba(13,15,19,0.55)]"
    >
      <main
        bind:this={scrollEl}
        inert={modalOpen}
        class="relative min-h-0 flex-1 no-scrollbar {tab === 'home'
          ? 'overflow-hidden'
          : 'overflow-y-auto pb-36'}"
      >
        <!-- Home stays mounted (hidden, not destroyed) so returning to it does
             not rebuild the Leaflet map or restart the location flow. It fills
             the viewport: its map runs edge to edge under the floating nav. -->
        <div class="h-full" class:hidden={tab !== 'home'}>
          <HomeView
            user={currentUser}
            onnavigate={navigate}
            incoming={pendingAlert}
            onviewalert={() => (incomingOpen = true)}
            ondismissincoming={dismissIncoming}
            coords={lastCoord}
            live={mapLive}
          />
        </div>

        {#key tab}
          {#if tab !== 'home'}
            <div in:fly={{ y: 10, duration: 260, opacity: 0.4 }}>
              {#if tab === 'alerts'}
                <AlertsView />
              {:else if tab === 'contacts'}
                <ContactsView />
              {:else}
                <ProfileView user={currentUser} onsignout={onSignOut} />
              {/if}
            </div>
          {/if}
        {/key}
      </main>

      <div
        class="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-32 bg-gradient-to-t from-canvas via-canvas/85 to-transparent"
      ></div>

      <div inert={modalOpen}>
        <BottomNav active={tab} onnavigate={navigate} onsos={() => (sosOpen = true)} />
      </div>

      <!-- The live region exists before any message so a screen reader announces
           the status instead of dropping a node that appeared with text in it. -->
      <div
        role="status"
        aria-live="polite"
        class="pointer-events-none absolute bottom-[112px] left-1/2 z-40 w-max max-w-[320px] -translate-x-1/2"
      >
        {#if toast}
          <p
            class="animate-rise rounded-full bg-ink/92 px-4 py-2.5 text-center text-[13px] font-medium text-white shadow-xl ring-1 ring-white/10 backdrop-blur"
          >
            {toast}
          </p>
        {/if}
      </div>

      {#if incomingOpen && pendingAlert}
        <AlertIncoming
          alert={pendingAlert}
          own={lastCoord}
          live={responderTrack}
          responded={respondedAlert}
          youId={currentUser?.id}
          busy={responding}
          error={respondError}
          onclose={dismissIncoming}
          onrespond={respondToAlert}
        />
      {/if}

      {#if sosOpen}
        <AlertFlow
          onclose={() => (sosOpen = false)}
          onnotify={notify}
          ontrack={handleTrack}
          live={liveTrack}
          coords={lastCoord}
        />
      {/if}
    </div>
  </div>
{/if}
