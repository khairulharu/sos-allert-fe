<script>
  import { X, Siren, Crosshair, Layers, MapPin, Bell } from '@lucide/svelte'
  import MapCard from './MapCard.svelte'
  import { place } from '$lib/stores.js'
  import { own, liveFix, responders, nearbyLoading, nearbyRadius } from '$lib/geo.js'
  import { emergencyLabel, distanceMeters, formatDistance } from '$lib/alertMeta.js'

  let {
    user = null,
    onnavigate,
    onviewalert,
    incoming = null,
    ondismissincoming,
    live = null,
    coords = null,
  } = $props()

  // The Home view stays mounted for the whole session, so the date and the
  // incoming alert's age cannot be computed once at mount.
  let clock = $state(Date.now())
  $effect(() => {
    const id = setInterval(() => (clock = Date.now()), 60_000)
    return () => clearInterval(id)
  })

  const incomingName = $derived(incoming?.sender?.name || 'Neighbor')
  const firstName = $derived(
    (user?.name || user?.fullName || '').trim().split(/\s+/)[0] || 'there',
  )
  const initials = $derived(
    user?.initials ||
      (user?.name || user?.fullName || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word[0]?.toUpperCase())
        .join('') ||
      '—',
  )
  const incomingType = $derived(emergencyLabel(incoming?.emergency_type))
  const incomingLocation = $derived(
    incoming?.latest_location || incoming?.initial_location || null,
  )
  const incomingDistance = $derived(distanceMeters(coords, incomingLocation))
  const incomingDistanceText = $derived(
    incomingDistance != null ? formatDistance(incomingDistance) : 'nearby',
  )
  const incomingWhen = $derived(timeAgoShort(incoming?.triggered_at, clock))

  // Heartbeat, nearby lookup, and polling live in src/lib/geo.js so a tab
  // switch reuses them instead of re-running the whole location flow.
  const areaLabel = $derived(
    $place || ($nearbyLoading ? 'Locating…' : 'Location unavailable'),
  )
  const responderCount = $derived(
    $nearbyLoading
      ? 'Locating…'
      : $responders.length > 0
        ? `${$responders.length} nearby`
        : 'None nearby',
  )

  function timeAgoShort(ts, at = Date.now()) {
    const value = Number(ts)
    if (!Number.isFinite(value)) return 'now'
    const seconds = Math.max(0, Math.round((at - value) / 1000))
    if (seconds < 60) return 'now'
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return `${minutes} min`
    const hours = Math.round(minutes / 60)
    return `${hours} hr`
  }

  const today = $derived(
    new Date(clock).toLocaleDateString('en-US', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }),
  )
  const todayShort = $derived(
    new Date(clock).toLocaleDateString('en-US', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }),
  )

  let mapRef = $state(null)
  let radiusOn = $state(true)

  function recenter() {
    mapRef?.recenter()
  }

  function toggleRadius() {
    radiusOn = !radiusOn
  }
</script>

<div class="relative h-full w-full overflow-hidden bg-[#E9EDF0]">
  <!-- The map is the surface, not a card: it runs edge to edge under every
       overlay, including the floating nav at the bottom of the shell. -->
  <MapCard
    bind:this={mapRef}
    fullscreen
    showControls={false}
    showFooter={false}
    showAttribution={false}
    responders={$responders}
    own={$liveFix ?? $own}
    live={live}
    radiusM={$nearbyRadius}
    radiusVisible={radiusOn}
  />

  <!-- Full-bleed top bar, then the overlays that flow underneath it. Only the
       OSM link, the incoming banner, and the map controls take pointer events;
       everything else lets map gestures through. -->
  <div class="pointer-events-none absolute inset-x-0 top-0 z-30">
    <header
      class="border-b border-black/5 bg-gradient-to-b from-white via-[#F8FAFF] to-[#EAF1FB] px-4 pb-4 pt-[max(20px,env(safe-area-inset-top))] shadow-[0_12px_30px_-18px_rgba(13,15,19,0.35)]"
    >
      <div class="min-w-0">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="truncate text-[17px] font-semibold leading-tight tracking-[-0.02em] text-ink">
              Hi, {firstName}
            </p>
            <p class="mt-0.5 truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
              <span class="hidden max-[359px]:inline">{todayShort}</span>
              <span class="max-[359px]:hidden">{today}</span>
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              aria-label="Alerts"
              onclick={() => onnavigate?.('alerts')}
              class="pointer-events-auto relative grid h-10 w-10 place-items-center rounded-full bg-white/70 text-ink/70 ring-1 ring-black/5 transition hover:text-ink active:scale-95"
            >
              <Bell size={17} strokeWidth={2} />
              {#if incoming}
                <span
                  class="absolute right-2.5 top-2.5 h-1.5 w-1.5 rounded-full bg-sos ring-2 ring-white"
                ></span>
              {/if}
            </button>
            <button
              type="button"
              aria-label="Open profile"
              onclick={() => onnavigate?.('profile')}
              class="pointer-events-auto grid h-10 w-10 place-items-center rounded-full bg-[#1F2937] text-[12px] font-bold text-white ring-2 ring-white transition active:scale-95"
              >{initials}</button
            >
          </div>
        </div>

        <div class="mt-2">
          <span
            class="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#2F6BFF]/25 bg-white/65 py-0.5 pl-0.5 pr-2.5 text-[12px] font-medium leading-tight text-ink/80 shadow-[0_2px_10px_-4px_rgba(47,107,255,0.35)]"
          >
            <span
              class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#2F6BFF]/10 shadow-[0_0_10px_rgba(47,107,255,0.45)]"
            >
              <MapPin size={13} strokeWidth={2.4} class="text-[#2F6BFF]" />
            </span>
            <span class="min-w-0 truncate">{areaLabel}</span>
          </span>
        </div>

        <p class="mt-1.5 flex min-w-0 items-center gap-1.5 text-[12px] leading-tight text-muted">
          <span class="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
            <span class="absolute inline-flex h-full w-full animate-live rounded-full bg-safe opacity-60"></span>
            <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-safe"></span>
          </span>
          <span class="shrink-0 font-semibold text-ink/70">Responders</span>
          <span class="min-w-0 truncate" aria-live="polite">· {responderCount}</span>
        </p>
      </div>
      <p class="mt-2 text-right text-[11px] leading-none text-muted">
        <a
          class="pointer-events-auto underline decoration-muted/40 underline-offset-2"
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer">© OpenStreetMap contributors</a
        >
      </p>
    </header>

    <div class="mt-3 flex flex-col gap-2 px-3">
      <!-- incoming alert -->
      {#if incoming}
        <section
          class="pointer-events-auto animate-rise flex w-full items-center gap-2.5 rounded-[22px] bg-[#FFF1F0]/95 p-2.5 shadow-[0_18px_44px_-20px_rgba(143,29,23,0.5)] ring-1 ring-sos/15 backdrop-blur-xl"
        >
          <span class="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sos/10">
            <span class="absolute h-full w-full rounded-full bg-sos/20 animate-sos-pulse"></span>
            <Siren size={16} class="relative text-sos" strokeWidth={2.3} />
          </span>
          <button type="button" onclick={onviewalert} class="min-w-0 flex-1 text-left">
            <p class="truncate text-[13px] font-semibold leading-tight text-[#8f1d17]">
              <span class="max-[359px]:hidden">SOS nearby ·</span>{' '}{incomingName}
            </p>
            <p class="mt-0.5 flex flex-wrap items-center gap-x-1 text-[12.5px] leading-tight text-[#b0544f]">
              <span>{incomingType} · {incomingDistanceText}</span><span class="sr-only"> · </span
              ><span class="hidden min-[390px]:inline" aria-hidden="true">·</span
              ><span class="w-full min-[390px]:w-auto">{incomingWhen}</span>
            </p>
          </button>
          <button
            type="button"
            onclick={onviewalert}
            class="shrink-0 rounded-full bg-sos px-3 py-2 text-[12px] font-semibold text-white transition active:scale-95"
            >Respond</button
          >
          <button
            type="button"
            aria-label="Dismiss alert"
            onclick={ondismissincoming}
            class="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#c98b87] transition hover:text-[#8f1d17]"
          >
            <X size={14} />
          </button>
        </section>
      {/if}

      <!-- map controls: secondary, so they yield to an incoming banner. -->
      {#if !incoming}
        <div class="pointer-events-auto ml-auto flex flex-col gap-2">
          <button
            type="button"
            aria-label="Recenter map on my location"
            onclick={recenter}
            class="grid h-10 w-10 place-items-center rounded-full bg-white/90 text-ink/70 shadow-[0_10px_30px_-14px_rgba(16,24,40,0.45)] ring-1 ring-black/5 backdrop-blur-xl transition hover:text-ink active:scale-95"
          >
            <Crosshair size={17} strokeWidth={2.2} />
          </button>
          <button
            type="button"
            aria-label="Toggle radius circle"
            aria-pressed={radiusOn}
            onclick={toggleRadius}
            class="grid h-10 w-10 place-items-center rounded-full shadow-[0_10px_30px_-14px_rgba(16,24,40,0.45)] ring-1 ring-black/5 backdrop-blur-xl transition active:scale-95 {radiusOn
              ? 'bg-white/90 text-ink/70 hover:text-ink'
              : 'bg-ink text-white'}"
          >
            <Layers size={17} strokeWidth={2.2} />
          </button>
        </div>
      {/if}
    </div>
  </div>
</div>
