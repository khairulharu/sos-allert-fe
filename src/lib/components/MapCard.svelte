<script>
  import { onMount, untrack } from 'svelte'
  import { Crosshair, Layers, ChevronRight } from '@lucide/svelte'
  import L from 'leaflet'
  import 'leaflet/dist/leaflet.css'

  let {
    height = 'h-[228px]',
    radiusLabel = null,
    showFooter = true,
    onopen,
    responders = [],
    own = null,
    focus = null,
    live = null,
    radiusM = 1000,
    showControls = true,
    showRadiusDefault = true,
    // Controlled from the parent when supplied (HomeView draws its own chrome);
    // left undefined, the component owns the toggle like before.
    radiusVisible = undefined,
    fullscreen = false,
    showAttribution = true,
  } = $props()

  const FALLBACK_CENTER = [-6.2, 106.816]
  const PIN_COLORS = ['#E7A93B', '#6E8FE8', '#43A98A', '#D97798']

  let mapEl = $state(null)
  let map = null
  let markersLayer = null
  let liveMarker = null
  let resizeObserver = null
  let centered = false
  let localRadius = $state(untrack(() => showRadiusDefault))
  const showRadius = $derived(radiusVisible === undefined ? localRadius : radiusVisible)

  function coordsFor(value) {
    return value &&
      Number.isFinite(value.latitude) &&
      Number.isFinite(value.longitude)
      ? [value.latitude, value.longitude]
      : null
  }

  const focusCoords = $derived(coordsFor(focus))
  const ownCoords = $derived(coordsFor(own))
  const center = $derived(focusCoords || ownCoords || FALLBACK_CENTER)

  const label = $derived(
    radiusLabel ||
      `Live · ${radiusM >= 1000 ? `${radiusM / 1000} km` : `${radiusM} m`} radius`,
  )

  // The footer is only interactive when the parent supplies a handler; with no
  // onopen it renders as a plain panel instead of a button that does nothing.
  const openable = $derived(typeof onopen === 'function')

  const closest = $derived(
    responders.reduce(
      (min, person) =>
        Number.isFinite(person.distance_m) && (min == null || person.distance_m < min)
          ? person.distance_m
          : min,
      null,
    ),
  )

  function distanceLabel(m) {
    if (!Number.isFinite(m)) return '—'
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`
  }

  function youIcon() {
    return L.divIcon({
      className: 'sos-map-icon',
      html: '<span class="sos-map-you"><span></span></span>',
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    })
  }

  function responderIcon(index) {
    return L.divIcon({
      className: 'sos-map-icon',
      html: `<span class="sos-map-pin" style="--pin:${PIN_COLORS[index % PIN_COLORS.length]}"></span>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    })
  }

  function validCoords(latitude, longitude) {
    return Number.isFinite(latitude) && Number.isFinite(longitude)
  }

  function focusIcon() {
    return L.divIcon({
      className: 'sos-map-icon',
      html: '<span class="sos-map-focus relative grid h-7 w-7 place-items-center"><span class="absolute inset-0 rounded-full bg-[#E7A93B]/25"></span><span class="h-3 w-3 rounded-full bg-[#E7A93B] ring-[2.5px] ring-white shadow-sm"></span></span>',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    })
  }

  function liveIsActive() {
    if (!live || !validCoords(live.latitude, live.longitude)) return false
    return !['RESOLVED', 'CANCELLED', 'EXPIRED'].includes(live.status)
  }

  function liveIcon() {
    return L.divIcon({
      className: 'sos-map-icon',
      html: '<span class="sos-map-live relative grid h-8 w-8 place-items-center"><span class="absolute inset-0 rounded-full bg-sos/25 animate-sos-pulse"></span><span class="h-3.5 w-3.5 rounded-full bg-sos shadow-sm ring-[2.5px] ring-white"></span></span>',
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    })
  }

  function syncLiveMarker() {
    if (!map) return
    if (!liveIsActive()) {
      if (liveMarker) {
        liveMarker.remove()
        liveMarker = null
      }
      return
    }
    const position = [live.latitude, live.longitude]
    if (liveMarker) {
      liveMarker.setLatLng(position)
      return
    }
    liveMarker = L.marker(position, {
      icon: liveIcon(),
      keyboard: false,
      zIndexOffset: 1400,
    })
      .addTo(map)
      .bindTooltip('Live SOS location', { direction: 'top', offset: [0, -16] })
  }

  function draw() {
    if (!map) return

    const [lat, lng] = center

    // Follow the first known position; afterwards the map stays where the
    // user left it (recenter is explicit).
    if (!centered && (focusCoords || ownCoords)) {
      map.setView(center, 15)
      centered = true
    }

    if (markersLayer) markersLayer.remove()
    markersLayer = L.layerGroup().addTo(map)

    if (focusCoords) {
      L.marker(focusCoords, { icon: focusIcon(), keyboard: false, zIndexOffset: 1200 })
        .addTo(markersLayer)
        .bindTooltip('Nearby SOS', { direction: 'top', offset: [0, -14] })
    }

    if (showRadius) {
      L.circle(center, {
        radius: radiusM,
        color: '#FF3B30',
        weight: 1.5,
        opacity: fullscreen ? 0.5 : 0.55,
        dashArray: '4 6',
        fillColor: '#FF3B30',
        // Fullscreen the circle covers most of the viewport; keep the tint a
        // hint so map labels stay the surface, not the overlay.
        fillOpacity: fullscreen ? 0.06 : 0.11,
        interactive: false,
      }).addTo(markersLayer)
    }

    if (ownCoords) {
      // A network fix can be kilometres off; show the area the browser reports
      // instead of a point that claims precision it does not have.
      const accuracy = Number(own?.accuracy)
      if (Number.isFinite(accuracy) && accuracy > 0) {
        L.circle(ownCoords, {
          radius: accuracy,
          color: '#2F6BFF',
          weight: 1,
          opacity: 0.35,
          fillColor: '#2F6BFF',
          fillOpacity: 0.08,
          interactive: false,
        }).addTo(markersLayer)
      }
      L.marker(ownCoords, { icon: youIcon(), keyboard: false, zIndexOffset: 1000 })
        .addTo(markersLayer)
        .bindTooltip('You', { direction: 'top', offset: [0, -12] })
    }

    responders.forEach((person, index) => {
      if (!validCoords(person.latitude, person.longitude)) return
      L.marker([person.latitude, person.longitude], {
        icon: responderIcon(index),
        keyboard: false,
      })
        .addTo(markersLayer)
        .bindTooltip(`Responder · ${distanceLabel(person.distance_m)} away`, {
          direction: 'top',
          offset: [0, -8],
        })
    })
  }

  onMount(() => {
    map = L.map(mapEl, {
      zoomControl: false,
      attributionControl: showAttribution,
      scrollWheelZoom: false,
    })
    map.attributionControl?.setPrefix('')
    map.setView(center, 15)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    }).addTo(map)

    draw()
    syncLiveMarker()

    // HomeView stays mounted across tab switches (hidden instead of destroyed),
    // so the container goes 0 → full size on the way back and Leaflet has to
    // re-measure before it can place tiles.
    resizeObserver = new ResizeObserver(() => map?.invalidateSize())
    resizeObserver.observe(mapEl)

    return () => {
      resizeObserver?.disconnect()
      resizeObserver = null
      liveMarker = null
      map?.remove()
      map = null
      markersLayer = null
    }
  })

  $effect(() => {
    // Track reactive inputs and redraw markers whenever they change.
    const _center = center
    const _responders = responders
    const _radius = radiusM
    const _visible = showRadius
    if (!map) return
    draw()
  })

  $effect(() => {
    const _liveLat = live?.latitude
    const _liveLng = live?.longitude
    const _liveStatus = live?.status
    if (!map) return
    syncLiveMarker()
  })

  // Exported so a parent that hides `showControls` (HomeView) can drive the
  // same recenter action from its own floating chrome.
  export function recenter() {
    map?.setView(center, 15)
    centered = true
  }

  function toggleRadius() {
    if (radiusVisible === undefined) localRadius = !localRadius
  }
</script>

<div
  class="map-shell relative bg-[#E9EDF0] {fullscreen
    ? 'absolute inset-0 h-full w-full'
    : 'overflow-hidden rounded-[24px]'} {fullscreen ? '' : height} {showFooter
    ? 'with-footer'
    : ''}"
>
  <div
    bind:this={mapEl}
    class="absolute inset-0 z-0 h-full w-full"
    role="region"
    aria-label="Map of nearby responders"
  ></div>

  <!-- map controls -->
  {#if showControls && !fullscreen}
  <div class="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
    <span
      class="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-[12.5px] font-semibold text-ink shadow-sm ring-1 ring-black/5 backdrop-blur-md"
    >
      <span class="relative flex h-1.5 w-1.5">
        <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-sos opacity-70"></span>
        <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-sos"></span>
      </span>
      {label}
    </span>
    <div class="pointer-events-auto flex gap-1.5">
      <button
        type="button"
        aria-label="Recenter map on my location"
        onclick={recenter}
        class="grid h-8 w-8 place-items-center rounded-full bg-white/90 text-ink/70 shadow-sm ring-1 ring-black/5 backdrop-blur-md transition hover:text-ink active:scale-95"
      >
        <Crosshair size={15} strokeWidth={2.2} />
      </button>
      <button
        type="button"
        aria-label="Toggle radius circle"
        aria-pressed={showRadius}
        onclick={toggleRadius}
        class="grid h-8 w-8 place-items-center rounded-full shadow-sm ring-1 ring-black/5 backdrop-blur-md transition active:scale-95 {showRadius
          ? 'bg-white/90 text-ink/70 hover:text-ink'
          : 'bg-ink text-white'}"
      >
        <Layers size={15} strokeWidth={2.2} />
      </button>
    </div>
  </div>
  {/if}

  {#if showFooter && !fullscreen}
    <!-- This element is a <button> exactly when a click handler is attached. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <svelte:element
      this={openable ? 'button' : 'div'}
      type={openable ? 'button' : undefined}
      onclick={openable ? () => onopen?.() : undefined}
      class="absolute inset-x-2.5 bottom-2.5 flex items-center gap-3 rounded-[18px] bg-white/92 p-3 text-left shadow-[0_8px_24px_-12px_rgba(16,24,40,0.35)] ring-1 ring-black/5 backdrop-blur-xl {openable
        ? 'transition active:scale-[0.99]'
        : ''}"
    >
      <div class="flex -space-x-2">
        {#each responders.slice(0, 4) as person, i}
          <span
            class="grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold text-white ring-2 ring-white"
            style="background:{PIN_COLORS[i % PIN_COLORS.length]}"
            >•</span
          >
        {/each}
        {#if responders.length === 0}
          <span
            class="grid h-7 w-7 place-items-center rounded-full bg-[#E3E6EA] text-[11px] font-bold text-muted ring-2 ring-white"
            >—</span
          >
        {/if}
      </div>
      <div class="min-w-0 flex-1">
        {#if responders.length > 0}
          <p class="text-[13.5px] font-semibold leading-tight text-ink">
            {responders.length} responder{responders.length === 1 ? '' : 's'} nearby
          </p>
          <p class="text-[12.5px] leading-tight text-muted">
            Closest is {distanceLabel(closest)} away · positions approximate
          </p>
        {:else}
          <p class="text-[13.5px] font-semibold leading-tight text-ink">No responders nearby</p>
          <p class="text-[12.5px] leading-tight text-muted">Coverage updates in real time</p>
        {/if}
      </div>
      {#if openable}
        <ChevronRight size={17} class="text-muted" />
      {/if}
    </svelte:element>
  {/if}
</div>

<style>
  :global(.sos-map-icon) {
    background: transparent;
    border: 0;
  }

  :global(.sos-map-you) {
    display: grid;
    width: 26px;
    height: 26px;
    place-items: center;
    border-radius: 9999px;
    background: rgba(47, 107, 255, 0.16);
  }

  :global(.sos-map-you > span) {
    width: 13px;
    height: 13px;
    border-radius: 9999px;
    background: #2f6bff;
    border: 2.5px solid #fff;
    box-shadow: 0 1px 4px rgba(13, 15, 19, 0.35);
  }

  :global(.sos-map-pin) {
    display: block;
    width: 16px;
    height: 16px;
    border-radius: 9999px;
    background: var(--pin, #e7a93b);
    border: 2.5px solid #fff;
    box-shadow: 0 1px 4px rgba(13, 15, 19, 0.3);
  }

  :global(.map-shell .leaflet-container) {
    background: #e9edf0;
    font: inherit;
  }

  :global(.map-shell .leaflet-bottom.leaflet-right),
  :global(.map-shell .leaflet-bottom.leaflet-left) {
    max-width: 100%;
  }

  :global(.map-shell .leaflet-control-attribution) {
    font-size: 11px;
    line-height: 1.35;
    white-space: normal;
    max-width: 100%;
    margin: 0 10px 6px 0;
    padding: 0 4px;
    background: rgba(255, 255, 255, 0.85);
    color: #5b6270;
  }

  :global(.map-shell .leaflet-control-attribution a) {
    font-size: 11px;
    white-space: normal;
  }

  :global(.map-shell.with-footer .leaflet-bottom.leaflet-right) {
    bottom: 68px;
  }
</style>
