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
  import { session, restoreSession } from '$lib/stores.js'
  import { location as locationApi } from '$lib/api.js'

  let tab = $state('home')
  let sosOpen = $state(false)
  let incomingOpen = $state(false)
  let showIncoming = $state(false)
  let toast = $state('')
  let toastTimer
  let scrollEl = $state(null)

  // Session gate: authenticated state.
  let authed = $state(false)
  let currentUser = $state(null)

  onMount(() => {
    const restored = restoreSession()
    if (restored) {
      authed = true
      currentUser = restored
      startLocationHeartbeat()
    }
  })

  // Keep an eye on store so logout trips the gate.
  session.subscribe((s) => {
    authed = !!s.token && !!s.user
    if (s.user) currentUser = s.user
  })

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

  function respondToAlert() {
    incomingOpen = false
    showIncoming = false
    notify("You're on the way. Location shared.")
  }

  function onAuthSuccess() {
    const s = restoreSession()
    if (s) {
      authed = true
      currentUser = s
      startLocationHeartbeat()
    }
  }

  function onSignOut() {
    authed = false
    currentUser = null
    tab = 'home'
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
                showIncoming={showIncoming}
                onviewalert={() => (incomingOpen = true)}
                ondismissincoming={() => (showIncoming = false)}
                onsignout={onSignOut}
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

      {#if incomingOpen}
        <AlertIncoming onclose={() => (incomingOpen = false)} onrespond={respondToAlert} />
      {/if}

      {#if sosOpen}
        <AlertFlow onclose={() => (sosOpen = false)} onnotify={notify} coords={lastCoord} />
      {/if}
    </div>
  </div>
{/if}
