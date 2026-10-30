<script>
  import { Crosshair, Layers, ChevronRight } from '@lucide/svelte'
  import { responders } from '$lib/data.js'

  let {
    height = 'h-[228px]',
    radiusLabel = 'Live · 1 km radius',
    showFooter = true,
    onopen,
  } = $props()

  const pins = [
    { x: 148, y: 106, color: '#E7A93B', initials: 'SM' },
    { x: 258, y: 130, color: '#6E8FE8', initials: 'DP' },
    { x: 244, y: 182, color: '#43A98A', initials: 'AN' },
    { x: 138, y: 174, color: '#D97798', initials: 'MP' },
  ]
</script>

<div class="relative overflow-hidden rounded-[24px] bg-[#E9EDF0] {height}">
  <svg
    class="absolute inset-0 h-full w-full"
    viewBox="0 0 400 300"
    preserveAspectRatio="xMidYMid slice"
    role="img"
    aria-label="Map showing your location and responders within one kilometre"
  >
    <defs>
      <filter id="pinShadow" x="-60%" y="-60%" width="220%" height="220%">
        <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#0d0f13" flood-opacity="0.22" />
      </filter>
      <radialGradient id="mapGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#3B82F6" stop-opacity="0.18" />
        <stop offset="100%" stop-color="#3B82F6" stop-opacity="0" />
      </radialGradient>
    </defs>

    <rect width="400" height="300" fill="#EAEEF1" />

    <!-- water -->
    <path d="M318 -12 C 344 34, 392 40, 414 86 L 414 -12 Z" fill="#D3E6F1" />
    <!-- parks -->
    <rect x="24" y="192" width="88" height="62" rx="12" fill="#D9EBD9" />
    <rect x="252" y="38" width="58" height="34" rx="10" fill="#D9EBD9" />

    <!-- city blocks -->
    <g fill="#DFE4E8">
      <rect x="12" y="14" width="40" height="48" rx="4" />
      <rect x="60" y="12" width="52" height="50" rx="4" />
      <rect x="120" y="16" width="34" height="44" rx="4" />
      <rect x="162" y="12" width="38" height="48" rx="4" />
      <rect x="208" y="14" width="50" height="46" rx="4" />
      <rect x="266" y="12" width="30" height="14" rx="4" />
      <rect x="12" y="96" width="46" height="36" rx="4" />
      <rect x="66" y="94" width="40" height="40" rx="4" />
      <rect x="130" y="92" width="54" height="44" rx="4" />
      <rect x="192" y="96" width="34" height="36" rx="4" />
      <rect x="234" y="98" width="44" height="34" rx="4" />
      <rect x="286" y="92" width="52" height="44" rx="4" />
      <rect x="344" y="96" width="44" height="38" rx="4" />
      <rect x="14" y="158" width="34" height="22" rx="4" />
      <rect x="122" y="160" width="46" height="26" rx="4" />
      <rect x="176" y="158" width="52" height="30" rx="4" />
      <rect x="236" y="156" width="40" height="28" rx="4" />
      <rect x="284" y="158" width="50" height="26" rx="4" />
      <rect x="342" y="160" width="46" height="22" rx="4" />
      <rect x="122" y="214" width="40" height="46" rx="4" />
      <rect x="170" y="212" width="52" height="50" rx="4" />
      <rect x="230" y="214" width="42" height="46" rx="4" />
      <rect x="280" y="212" width="48" height="50" rx="4" />
      <rect x="336" y="214" width="52" height="46" rx="4" />
      <rect x="14" y="262" width="46" height="30" rx="4" />
      <rect x="68" y="264" width="38" height="28" rx="4" />
      <rect x="120" y="268" width="52" height="26" rx="4" />
      <rect x="182" y="266" width="38" height="28" rx="4" />
      <rect x="230" y="268" width="54" height="26" rx="4" />
      <rect x="292" y="268" width="40" height="26" rx="4" />
      <rect x="340" y="264" width="48" height="30" rx="4" />
    </g>

    <!-- roads -->
    <g stroke="#FBFCFD" stroke-width="13" stroke-linecap="round">
      <path d="M-10 78 H410" />
      <path d="M-10 146 H410" />
      <path d="M-10 204 H410" />
      <path d="M-10 260 H410" />
      <path d="M58 -10 V310" />
      <path d="M120 -10 V310" />
      <path d="M196 -10 V310" />
      <path d="M276 -10 V310" />
      <path d="M336 -10 V310" />
    </g>
    <path
      d="M-20 244 C 90 214, 190 188, 420 96"
      fill="none"
      stroke="#FDFDFE"
      stroke-width="16"
      stroke-linecap="round"
    />
    <path
      d="M-20 244 C 90 214, 190 188, 420 96"
      fill="none"
      stroke="#F1C453"
      stroke-width="1.4"
      stroke-dasharray="8 9"
      opacity="0.55"
    />

    <!-- street labels -->
    <g fill="#98A2AD" font-size="6.5" font-weight="600" letter-spacing="0.2">
      <text x="14" y="74" transform="rotate(-3 14 74)">JL. KEMANG RAYA</text>
      <text x="16" y="142">JL. BANGKA II</text>
      <text x="212" y="260">JL. KEMANG SELATAN</text>
      <text x="60" y="34" transform="rotate(-90 60 34)">JL. AMPERA</text>
    </g>

    <!-- one kilometre radius -->
    <circle cx="198" cy="152" r="104" fill="#FF3B30" opacity="0.05" />
    <circle
      cx="198"
      cy="152"
      r="104"
      fill="none"
      stroke="#FF3B30"
      stroke-opacity="0.35"
      stroke-width="1.5"
      stroke-dasharray="4 6"
    />
    <circle cx="198" cy="152" r="46" fill="url(#mapGlow)" />

    <!-- nearby responders -->
    {#each pins as pin}
      <g filter="url(#pinShadow)" class="animate-breathe">
        <circle cx={pin.x} cy={pin.y} r="10.5" fill={pin.color} stroke="#fff" stroke-width="2.4" />
        <text
          x={pin.x}
          y={pin.y + 2.6}
          text-anchor="middle"
          fill="#fff"
          font-size="7"
          font-weight="700"
          font-family="Inter, sans-serif">{pin.initials}</text
        >
      </g>
    {/each}

    <!-- you -->
    <circle cx="198" cy="152" r="20" fill="#2F6BFF" opacity="0.12" />
    <circle cx="198" cy="152" r="10.5" fill="#fff" />
    <circle cx="198" cy="152" r="7" fill="#2F6BFF" />
  </svg>

  <!-- map controls -->
  <div class="absolute inset-x-0 top-0 flex items-start justify-between p-3">
    <span
      class="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-semibold text-ink shadow-sm ring-1 ring-black/5 backdrop-blur-md"
    >
      <span class="relative flex h-1.5 w-1.5">
        <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-sos opacity-70"></span>
        <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-sos"></span>
      </span>
      {radiusLabel}
    </span>
    <div class="flex gap-1.5">
      <button
        type="button"
        aria-label="Recenter map"
        class="grid h-8 w-8 place-items-center rounded-full bg-white/90 text-ink/70 shadow-sm ring-1 ring-black/5 backdrop-blur-md transition hover:text-ink active:scale-95"
      >
        <Crosshair size={15} strokeWidth={2.2} />
      </button>
      <button
        type="button"
        aria-label="Map layers"
        class="grid h-8 w-8 place-items-center rounded-full bg-white/90 text-ink/70 shadow-sm ring-1 ring-black/5 backdrop-blur-md transition hover:text-ink active:scale-95"
      >
        <Layers size={15} strokeWidth={2.2} />
      </button>
    </div>
  </div>

  {#if showFooter}
    <button
      type="button"
      onclick={onopen}
      class="absolute inset-x-2.5 bottom-2.5 flex items-center gap-3 rounded-[18px] bg-white/92 p-3 text-left shadow-[0_8px_24px_-12px_rgba(16,24,40,0.35)] ring-1 ring-black/5 backdrop-blur-xl transition active:scale-[0.99]"
    >
      <div class="flex -space-x-2">
        {#each responders.slice(0, 4) as person}
          <span
            class="grid h-7 w-7 place-items-center rounded-full text-[9px] font-bold ring-2 ring-white {person.tone}"
            >{person.initials}</span
          >
        {/each}
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-[12.5px] font-semibold leading-tight text-ink">4 responders nearby</p>
        <p class="text-[11px] leading-tight text-muted">Closest is 180 m away</p>
      </div>
      <ChevronRight size={17} class="text-muted" />
    </button>
  {/if}
</div>
