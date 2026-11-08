<script>
  import { onMount } from 'svelte'
  import {
    Bell,
    MapPin,
    Phone,
    Send,
    Users,
    ArrowUpRight,
    Radio,
    X,
    Siren,
  } from '@lucide/svelte'
  import MapCard from './MapCard.svelte'
  import { contacts } from '$lib/api.js'
  import { place } from '$lib/stores.js'
  import { own, responders, nearbyError, nearbyLoading, nearbyRadius } from '$lib/geo.js'
  import { emergencyLabel, distanceMeters, formatDistance } from '$lib/alertMeta.js'

  let {
    user,
    onnavigate,
    onviewalert,
    incoming = null,
    ondismissincoming,
    onnotify,
    live = null,
    coords = { lat: -8.65, lng: 115.22 },
  } = $props()

  const name = $derived(user?.name || user?.fullName || 'there')
  const initials = $derived(
    user?.initials ||
      (user?.name
        ? user.name
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w[0]?.toUpperCase())
            .join('')
        : '—'),
  )
  const incomingName = $derived(incoming?.sender?.name || 'Neighbor')
  const incomingType = $derived(emergencyLabel(incoming?.emergency_type))
  const incomingLocation = $derived(
    incoming?.latest_location || incoming?.initial_location || null,
  )
  const incomingDistance = $derived(distanceMeters(coords, incomingLocation))
  const incomingDistanceText = $derived(
    incomingDistance != null ? formatDistance(incomingDistance) : 'nearby',
  )
  const incomingWhen = $derived(timeAgo(incoming?.triggered_at))

  let contactCount = $state(null)

  onMount(async () => {
    try {
      const data = await contacts.list()
      contactCount = Array.isArray(data) ? data.length : data?.length ?? 0
    } catch {
      contactCount = 0
    }
  })

  // ---- live responder map ----
  // Heartbeat, nearby lookup, and polling live in src/lib/geo.js so a tab
  // switch reuses them instead of re-running the whole location flow.
  const RESPONDER_TONES = [
    'bg-[#F2C879] text-[#6b4a10]',
    'bg-[#9DB8F5] text-[#1e3a8a]',
    'bg-[#A7DCC7] text-[#065f46]',
    'bg-[#F3B3C6] text-[#831843]',
  ]

  const alertHistory = $state([])

  // The header pill shows where the heartbeat actually is. geo.js resolves the
  // label once per ~110 m bucket (src/lib/place.js), keeps it warm across tab
  // switches, and shares it with the Profile screen — so navigating never
  // blanks it back to "Locating…".
  const areaLabel = $derived(
    $place || ($nearbyLoading ? 'Locating…' : 'Location unavailable'),
  )

  const responderView = $derived(
    $responders.map((person, i) => ({
      ...person,
      initials: 'R',
      tone: RESPONDER_TONES[i % RESPONDER_TONES.length],
      distance: distanceLabel(person.distance_m),
      seen: timeAgo(person.last_seen),
    })),
  )

  function distanceLabel(m) {
    if (!Number.isFinite(m)) return '—'
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`
  }

  function timeAgo(ts) {
    const value = Number(ts)
    if (!Number.isFinite(value)) return 'just now'
    const seconds = Math.max(0, Math.round((Date.now() - value) / 1000))
    if (seconds < 60) return 'just now'
    return `${Math.round(seconds / 60)} min ago`
  }

  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const today = now.toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  const quickActions = $derived([
    {
      id: 'call',
      label: 'Call 112',
      hint: 'Emergency',
      icon: Phone,
      tone: 'bg-[#FFECEB] text-sos',
      href: 'tel:112',
      ariaLabel: 'Call 112 emergency services',
    },
    {
      id: 'share',
      label: 'Share location',
      hint: 'Via Maps link',
      icon: Send,
      tone: 'bg-[#EAF0FF] text-[#2F6BFF]',
    },
    {
      id: 'contacts',
      label: 'Contacts',
      hint: contactCount != null ? `${contactCount} ${contactCount === 1 ? 'person' : 'people'}` : '—',
      icon: Users,
      tone: 'bg-[#E9F7F1] text-safe',
    },
  ])

  function runAction(id) {
    if (id === 'contacts') onnavigate?.('contacts')
    else if (id === 'share') shareLocation()
  }

  // Only a resolved platform call counts as success: the Web Share API when
  // the browser has it, otherwise the clipboard. A cancelled share fires
  // AbortError and stays silent.
  async function shareLocation() {
    if (!coords) {
      onnotify?.('Waiting for your location — try again in a moment')
      return
    }
    const text = `My live location: https://www.google.com/maps?q=${coords.lat},${coords.lng}`
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: 'My location', text })
        } catch (err) {
          if (err?.name === 'AbortError') return
          throw err
        }
        return
      }
      if (typeof navigator.clipboard?.writeText === 'function') {
        await navigator.clipboard.writeText(text)
        onnotify?.('Location link copied')
        return
      }
      onnotify?.('This browser cannot share your location link')
    } catch {
      onnotify?.('Could not share your location')
    }
  }
</script>

<div class="px-5 pb-4 pt-6">
  <!-- top bar -->
  <header class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <span class="relative grid h-8 w-8 place-items-center rounded-[11px] bg-ink">
        <span class="absolute inset-0 rounded-[11px] bg-gradient-to-br from-white/20 to-transparent"></span>
        <Siren size={16} class="relative text-white" strokeWidth={2.4} />
      </span>
      <div class="leading-none">
        <p class="text-[14px] font-bold tracking-[-0.01em]">sos<span class="text-sos">.</span>alert</p>
        <p class="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Community safety</p>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <button
        type="button"
        aria-label="Alerts"
        onclick={() => onnavigate?.('alerts')}
        class="relative grid h-9 w-9 place-items-center rounded-full bg-white text-ink/70 ring-1 ring-black/5 transition hover:text-ink active:scale-95"
      >
        <Bell size={17} strokeWidth={2} />
        <span class="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-sos ring-2 ring-white"></span>
      </button>
      <button
        type="button"
        aria-label="Open profile"
        onclick={() => onnavigate?.('profile')}
        class="grid h-9 w-9 place-items-center rounded-full bg-[#1F2937] text-[12.5px] font-bold text-white ring-2 ring-white transition active:scale-95"
        >{initials}</button
      >
    </div>
  </header>

  <!-- greeting -->
  <div class="mt-5">
    <p class="text-[13px] font-medium text-muted">{today}</p>
    <h1 class="mt-1 text-[26px] font-semibold leading-[1.15] tracking-[-0.035em]">
      {greeting}, {name}
    </h1>
    <div
      class="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[12.5px] font-semibold text-ink/80 ring-1 ring-black/5"
    >
      <MapPin size={12} class="text-sos" strokeWidth={2.6} />
      {areaLabel}
    </div>
  </div>

  <!-- incoming alert -->
  {#if incoming}
    <section
      class="animate-rise mt-3.5 flex items-center gap-3 rounded-[20px] bg-[#FFF1F0] p-3 ring-1 ring-sos/10"
    >
      <span class="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sos/10">
        <span class="absolute h-full w-full rounded-full bg-sos/20 animate-sos-pulse"></span>
        <Siren size={16} class="relative text-sos" strokeWidth={2.3} />
      </span>
      <button type="button" onclick={onviewalert} class="min-w-0 flex-1 text-left">
        <p class="truncate text-[13px] font-semibold leading-tight text-[#8f1d17]">
          SOS nearby · {incomingName}
        </p>
        <p class="mt-0.5 text-[12.5px] leading-tight text-[#b0544f]">
          {incomingType} · {incomingDistanceText} away · {incomingWhen}
        </p>
      </button>
      <button
        type="button"
        onclick={onviewalert}
        class="shrink-0 rounded-full bg-sos px-3 py-1.5 text-[12px] font-semibold text-white transition active:scale-95"
        >Respond</button
      >
      <button
        type="button"
        aria-label="Dismiss alert"
        onclick={ondismissincoming}
        class="shrink-0 text-[#c98b87] transition hover:text-[#8f1d17]"
      >
        <X size={14} />
      </button>
    </section>
  {/if}

  <!-- around you -->
  <section class="mt-5">
    <div class="flex items-end justify-between px-0.5">
      <div>
        <h2 class="text-[15px] font-semibold tracking-[-0.01em]">Around you</h2>
        <p class="mt-0.5 text-[12.5px] text-muted">Live safety map · updates every 15 s</p>
      </div>
      <button
        type="button"
        onclick={() => onnavigate?.('contacts')}
        class="text-[12.5px] font-semibold text-ink/60 transition hover:text-ink">View all</button
      >
    </div>

    <div class="mt-3">
      <MapCard
        height="h-[300px]"
        onopen={() => onnavigate?.('contacts')}
        responders={$responders}
        own={$own}
        live={live}
        radiusM={$nearbyRadius}
      />
    </div>
  </section>

  <!-- quick actions -->
  <section class="mt-4 grid grid-cols-3 gap-2.5">
    {#each quickActions as action}
      {@const Icon = action.icon}
      <!-- Call 112 is a real tel: link; the other two are buttons. -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <svelte:element
        this={action.href ? 'a' : 'button'}
        href={action.href}
        type={action.href ? undefined : 'button'}
        aria-label={action.ariaLabel}
        onclick={() => runAction(action.id)}
        class="card flex flex-col items-start gap-2.5 rounded-[20px] p-3 text-left transition active:scale-[0.98]"
      >
        <span class="grid h-8 w-8 place-items-center rounded-xl {action.tone}">
          <Icon size={15} strokeWidth={2.2} />
        </span>
        <span class="leading-tight">
          <span class="block text-[13px] font-semibold text-ink">{action.label}</span>
          <span class="mt-0.5 block text-[12px] text-muted">{action.hint}</span>
        </span>
      </svelte:element>
    {/each}
  </section>

  <!-- responders -->
  <section class="mt-6">
    <div class="flex items-end justify-between px-0.5">
      <div>
        <h2 class="text-[15px] font-semibold tracking-[-0.01em]">Nearby responders</h2>
        <p class="mt-0.5 text-[12.5px] text-muted">Approximate positions · no personal details</p>
      </div>
      <button
        type="button"
        onclick={() => onnavigate?.('contacts')}
        class="text-[12.5px] font-semibold text-ink/60 transition hover:text-ink">See all</button
      >
    </div>

    <div class="card mt-3 divide-y divide-line/80 overflow-hidden">
      {#if responderView.length > 0}
        {#each responderView.slice(0, 3) as person}
          <div class="flex w-full items-center gap-3 px-4 py-3 text-left">
            <span class="relative">
              <span class="grid h-10 w-10 place-items-center rounded-full text-[13px] font-bold {person.tone}"
                >{person.initials}</span
              >
              <span
                class="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-safe ring-2 ring-white"
              ></span>
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[14px] font-semibold text-ink">Responder</span>
              <span class="mt-0.5 block text-[12.5px] text-muted"
                >{person.distance} away · active {person.seen}</span
              >
            </span>
            <span class="rounded-full bg-[#F5F6F8] px-2 py-1 text-[11px] font-semibold text-ink/55"
              >Live</span
            >
          </div>
        {/each}
      {:else if $nearbyLoading}
        <div class="px-4 py-8 text-center">
          <p class="text-[13.5px] font-semibold text-ink">Locating responders…</p>
          <p class="mt-1 text-[12.5px] text-muted">Using your latest heartbeat.</p>
        </div>
      {:else}
        <div class="px-4 py-8 text-center">
          <p class="text-[13.5px] font-semibold text-ink">No responders nearby</p>
          <p class="mt-1 text-[12.5px] text-muted">{$nearbyError || 'Coverage updates in real time.'}</p>
        </div>
      {/if}
    </div>
  </section>

  <!-- recent activity -->
  <section class="mt-6">
    <div class="flex items-end justify-between px-0.5">
      <h2 class="text-[15px] font-semibold tracking-[-0.01em]">Recent activity</h2>
      <button
        type="button"
        onclick={() => onnavigate?.('alerts')}
        class="text-[12.5px] font-semibold text-ink/60 transition hover:text-ink">History</button
      >
    </div>

    <div class="card mt-3 divide-y divide-line/80 overflow-hidden">
      {#if alertHistory.length > 0}
        {#each alertHistory.slice(0, 2) as item}
          <button
            type="button"
            onclick={() => onnavigate?.('alerts')}
            class="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-[#FAFBFC]"
          >
            <span
              class="grid h-9 w-9 place-items-center rounded-full {item.type === 'sent'
                ? 'bg-[#FFECEB] text-sos'
                : 'bg-[#E9F7F1] text-safe'}"
            >
              {#if item.type === 'sent'}
                <ArrowUpRight size={15} strokeWidth={2.4} />
              {:else}
                <Radio size={15} strokeWidth={2.2} />
              {/if}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[13.5px] font-semibold text-ink">{item.title}</span>
              <span class="mt-0.5 block text-[12.5px] text-muted">{item.date} · {item.time} · {item.place}</span>
            </span>
            <span
              class="rounded-full px-2 py-1 text-[11px] font-semibold {item.status === 'Cancelled'
                ? 'bg-[#F3F4F6] text-muted'
                : 'bg-[#E9F7F1] text-[#087a54]'}">{item.status}</span
            >
          </button>
        {/each}
      {:else}
        <div class="px-4 py-8 text-center">
          <p class="text-[13.5px] font-semibold text-ink">No recent activity</p>
          <p class="mt-1 text-[12.5px] text-muted">Sent and received alerts will appear here.</p>
        </div>
      {/if}
    </div>
  </section>

  <p class="mt-6 text-center text-[12px] leading-relaxed text-muted">
    Alerts reach responders within a 1 km radius.<br />
    In immediate danger, call <span class="font-semibold text-ink/70">112</span>.
  </p>
</div>
