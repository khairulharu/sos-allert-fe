<script>
  import { onMount } from 'svelte'
  import { fly } from 'svelte/transition'
  import BottomNav from '$lib/components/BottomNav.svelte'
  import HomeView from '$lib/components/HomeView.svelte'
  import AlertsView from '$lib/components/AlertsView.svelte'
  import ContactsView from '$lib/components/ContactsView.svelte'
  import ProfileView from '$lib/components/ProfileView.svelte'
  import AlertFlow from '$lib/components/AlertFlow.svelte'
  import AlertIncoming from '$lib/components/AlertIncoming.svelte'
  import AuthScreen from '$lib/components/AuthScreen.svelte'
  import { session, restoreSession, logout } from '$lib/stores.js'
  import { location as locationApi, sos as sosApi } from '$lib/api.js'
  import {
    tracking,
    responderTracking,
    startTracking,
    stopTracking,
    startResponderTracking,
    stopResponderTracking,
  } from '$lib/tracking.js'
  import { formatDistance, formatEta } from '$lib/alertMeta.js'

  let tab = $state('home')
  let sosOpen = $state(false)
  let incomingOpen = $state(false)
  let pendingAlert = $state(null)
  let responding = $state(false)
  let respondError = $state('')
  let toast = $state('')
  let toastTimer
  let scrollEl = $state(null)
  let inboxTimer
  let inboxPolling = false
  let inboxInitialised = false
  const dismissedAlerts = new Set()

  // Session gate: authenticated state.
  let authed = $state(false)
  let currentUser = $state(null)

  onMount(() => {
    const restored = restoreSession()
    if (restored) {
      authed = true
      currentUser = restored
      startLocationHeartbeat()
      syncActiveTracking()
      startInboxPolling()
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

      if (incomingOpen && current) {
        // Keep the sheet stable while the user is reading it.
        pendingAlert = current
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

  function startInboxPolling() {
    if (inboxTimer) return
    pollInbox()
    inboxTimer = setInterval(() => {
      if (!document.hidden) pollInbox()
    }, INBOX_POLL_MS)
  }

  function stopInboxPolling() {
    clearInterval(inboxTimer)
    inboxTimer = null
    inboxPolling = false
    inboxInitialised = false
    pendingAlert = null
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
    respondError = ''
  }

  function browserPosition() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null)
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 4000, maximumAge: 60000 },
      )
    })
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
      incomingOpen = false
      pendingAlert = null

      const eta = formatEta(Number(result?.eta_seconds))
      const distance = formatDistance(Number(result?.victim_distance_meters))
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

  // ---- geolocation + heartbeat ----
  let heartbeatTimer
  let lastCoord = $state({ lat: -8.65, lng: 115.22 })

  function startLocationHeartbeat() {
    if (heartbeatTimer) return
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => (lastCoord = { lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 },
      )
    }
    const send = async () => {
      try {
        await locationApi.update(lastCoord.lat, lastCoord.lng)
      } catch {
        /* heartbeat failures are safe to ignore */
      }
    }
    send()
    heartbeatTimer = setInterval(send, 60000)
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
    const s = restoreSession()
    if (s) {
      authed = true
      currentUser = s
      startLocationHeartbeat()
      syncActiveTracking()
      startInboxPolling()
    }
  }

  function onSignOut() {
    stopInboxPolling()
    stopTracking()
    authed = false
    currentUser = null
    tab = 'home'
  }

  async function onSessionExpired() {
    stopInboxPolling()
    stopTracking()
    await logout()
  }
</script>

<svelte:head>
  <meta name="description" content="SOS Alert — a community safety app that gets help to you in seconds." />
</svelte:head>

{#if !authed}
  <AuthScreen onsuccess={onAuthSuccess} />
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
      <main bind:this={scrollEl} class="relative min-h-0 flex-1 overflow-y-auto pb-36 no-scrollbar">
        {#key tab}
          <div in:fly={{ y: 10, duration: 260, opacity: 0.4 }}>
            {#if tab === 'home'}
              <HomeView
                user={currentUser}
                onnavigate={navigate}
                onnotify={notify}
                incoming={pendingAlert}
                onviewalert={() => (incomingOpen = true)}
                ondismissincoming={dismissIncoming}
                onsignout={onSignOut}
                coords={lastCoord}
                live={mapLive}
                onsessionexpired={onSessionExpired}
              />
            {:else if tab === 'alerts'}
              <AlertsView />
            {:else if tab === 'contacts'}
              <ContactsView />
            {:else}
              <ProfileView user={currentUser} onsignout={onSignOut} />
            {/if}
          </div>
        {/key}
      </main>

      <div
        class="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-32 bg-gradient-to-t from-canvas via-canvas/85 to-transparent"
      ></div>

      <BottomNav active={tab} onnavigate={navigate} onsos={() => (sosOpen = true)} />

      {#if toast}
        <div
          class="pointer-events-none absolute bottom-[112px] left-1/2 z-40 w-max max-w-[320px] -translate-x-1/2"
          in:fly={{ y: 12, duration: 220 }}
        >
          <p
            class="rounded-full bg-ink/92 px-4 py-2.5 text-center text-[11px] font-medium text-white shadow-xl ring-1 ring-white/10 backdrop-blur"
          >
            {toast}
          </p>
        </div>
      {/if}

      {#if incomingOpen && pendingAlert}
        <AlertIncoming
          alert={pendingAlert}
          own={lastCoord}
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
