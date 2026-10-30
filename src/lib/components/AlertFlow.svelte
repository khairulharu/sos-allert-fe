<script>
  import { fade, scale } from 'svelte/transition'
  import { X, Phone, MessageCircle, ShieldCheck, Check, MapPin, Radio, Loader2 } from '@lucide/svelte'
  import MapCard from './MapCard.svelte'
  import { responders } from '$lib/data.js'

  let { onclose, onnotify } = $props()

  let phase = $state('count')
  let countdown = $state(5)
  let elapsed = $state(0)
  let ackCount = $state(1)
  let confirming = $state(false)

  const total = 5
  const RING = 2 * Math.PI * 44

  function pad(value) {
    return String(value).padStart(2, '0')
  }

  function elapsedLabel(seconds) {
    return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`
  }

  function stop() {
    onnotify?.('SOS cancelled. No alert was sent.')
    onclose?.()
  }

  function backHome() {
    onnotify?.("You're marked safe. Alert ended.")
    onclose?.()
  }

  function endAlert() {
    if (!confirming) {
      confirming = true
      return
    }
    confirming = false
    phase = 'ended'
  }

  $effect(() => {
    if (phase !== 'count') return
    let remaining = total
    const id = setInterval(() => {
      remaining -= 1
      countdown = Math.max(remaining, 0)
      if (remaining <= 0) {
        clearInterval(id)
        phase = 'sending'
      }
    }, 1000)
    return () => clearInterval(id)
  })

  $effect(() => {
    if (phase !== 'sending') return
    const id = setTimeout(() => (phase = 'active'), 1500)
    return () => clearTimeout(id)
  })

  $effect(() => {
    if (phase !== 'active') return
    const id = setInterval(() => (elapsed += 1), 1000)
    return () => clearInterval(id)
  })

  $effect(() => {
    if (phase !== 'active') return
    const first = setTimeout(() => (ackCount = Math.min(ackCount + 1, 4)), 2200)
    const second = setTimeout(() => (ackCount = Math.min(ackCount + 1, 4)), 5200)
    return () => {
      clearTimeout(first)
      clearTimeout(second)
    }
  })

  function onKeydown(event) {
    if (event.key !== 'Escape') return
    if (phase === 'count') stop()
    if (phase === 'ended') backHome()
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="absolute inset-0 z-50 flex flex-col overflow-hidden"
  transition:fade={{ duration: 220 }}
  role="dialog"
  aria-modal="true"
  aria-label="Emergency SOS"
>
  {#if phase === 'count' || phase === 'sending'}
    <!-- COUNTDOWN / SENDING -->
    <div class="absolute inset-0 bg-gradient-to-b from-[#FF4A3F] via-[#EE2B22] to-[#B81710]"></div>
    <div
      class="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-white/15 blur-3xl"
    ></div>
    <div
      class="pointer-events-none absolute -bottom-32 -right-16 h-80 w-80 rounded-full bg-[#7A0C07]/40 blur-3xl"
    ></div>

    <div class="relative flex h-full flex-col px-6 pb-8 pt-7 text-white">
      <div class="flex items-center justify-between">
        <span
          class="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ring-1 ring-white/20 backdrop-blur"
        >
          <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-white"></span>
          Emergency SOS
        </span>
        {#if phase === 'count'}
          <button
            type="button"
            aria-label="Cancel SOS"
            onclick={stop}
            class="grid h-9 w-9 place-items-center rounded-full bg-white/15 ring-1 ring-white/20 backdrop-blur transition hover:bg-white/25 active:scale-95"
          >
            <X size={17} />
          </button>
        {/if}
      </div>

      {#if phase === 'count'}
        <div class="flex flex-1 flex-col items-center justify-center" in:fade={{ duration: 180 }}>
          <div class="relative grid h-[212px] w-[212px] place-items-center">
            <span class="absolute h-[196px] w-[196px] rounded-full border border-white/20"></span>
            <span class="absolute h-[196px] w-[196px] rounded-full bg-white/5 animate-breathe"></span>
            <svg class="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="2.5" />
              <circle
                cx="50"
                cy="50"
                r="44"
                fill="none"
                stroke="#fff"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-dasharray={RING}
                stroke-dashoffset={RING * (1 - countdown / total)}
                style="transition: stroke-dashoffset 1s linear"
              />
            </svg>
            <div class="flex flex-col items-center">
              <span class="text-[86px] font-semibold leading-none tracking-[-0.06em] tabular-nums">
                {countdown}
              </span>
              <span class="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70"
                >seconds</span
              >
            </div>
          </div>

          <h2 class="mt-7 text-center text-[22px] font-semibold tracking-[-0.02em]">
            Sending SOS in {countdown}
          </h2>
          <p class="mt-2 max-w-[270px] text-center text-[12.5px] leading-relaxed text-white/70">
            {responders.length} responders within 1&nbsp;km will get your live location and a call for help.
          </p>
        </div>

        <div class="space-y-2.5">
          <button
            type="button"
            onclick={stop}
            class="w-full rounded-full bg-white py-3.5 text-[13.5px] font-semibold text-[#C41912] shadow-lg transition active:scale-[0.98]"
          >
            Cancel alert
          </button>
          <p class="text-center text-[10.5px] text-white/60">Accidental tap? You can still cancel.</p>
        </div>
      {:else}
        <div class="flex flex-1 flex-col items-center justify-center" in:fade={{ duration: 180 }}>
          <div class="relative grid h-[164px] w-[164px] place-items-center">
            <span class="absolute h-[150px] w-[150px] rounded-full bg-white/10 animate-sos-pulse"></span>
            <span
              class="absolute h-[150px] w-[150px] rounded-full bg-white/10 animate-sos-pulse"
              style="animation-delay: 1s"
            ></span>
            <span class="grid h-[104px] w-[104px] place-items-center rounded-full bg-white/15 ring-1 ring-white/25 backdrop-blur">
              <Radio size={42} strokeWidth={1.8} class="text-white" />
            </span>
          </div>

          <h2 class="mt-8 text-center text-[22px] font-semibold tracking-[-0.02em]">
            Alerting responders nearby
          </h2>
          <p class="mt-2 text-center text-[12.5px] text-white/70">Sharing your live location securely…</p>

          <div class="mt-6 flex items-center gap-1.5">
            {#each [0, 1, 2] as dot}
              <span
                class="h-1.5 w-1.5 animate-bounce rounded-full bg-white/80"
                style="animation-delay: {dot * 150}ms"
              ></span>
            {/each}
          </div>
        </div>

        <div class="flex items-center justify-center gap-2 text-[10.5px] font-medium text-white/60">
          <Loader2 size={12} class="animate-spin" />
          Connecting to the responder network
        </div>
      {/if}
    </div>
  {:else if phase === 'active'}
    <!-- ACTIVE ALERT -->
    <div class="absolute inset-0 bg-[#0C0D10]"></div>
    <div
      class="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-sos/30 blur-3xl"
    ></div>
    <div
      class="pointer-events-none absolute -bottom-24 -right-20 h-64 w-64 rounded-full bg-[#2F6BFF]/15 blur-3xl"
    ></div>

    <div
      class="relative flex h-full flex-col overflow-y-auto px-5 pb-7 pt-6 text-white no-scrollbar"
      in:fade={{ duration: 200 }}
    >
      <div class="flex items-center justify-between">
        <span
          class="inline-flex items-center gap-2 rounded-full bg-sos/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#FF8A82] ring-1 ring-sos/25"
        >
          <span class="relative flex h-1.5 w-1.5">
            <span class="absolute h-full w-full animate-ping rounded-full bg-sos"></span>
            <span class="relative h-1.5 w-1.5 rounded-full bg-sos"></span>
          </span>
          SOS active
        </span>
        <div class="text-right">
          <p class="text-[9px] font-semibold uppercase tracking-[0.16em] text-white/40">Elapsed</p>
          <p class="text-[17px] font-semibold tabular-nums leading-tight">{elapsedLabel(elapsed)}</p>
        </div>
      </div>

      <div class="mt-5">
        <h2 class="text-[25px] font-semibold leading-tight tracking-[-0.03em]">Help is on the way</h2>
        <p class="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-white/50">
          <MapPin size={12} class="text-sos" />
          Jl. Kemang Raya · Sharing live location
        </p>
      </div>

      <div class="mt-4">
        <MapCard height="h-[164px]" showFooter={false} radiusLabel="Live · 1 km" />
      </div>

      <div class="mt-4 flex items-center justify-between px-0.5">
        <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
          Responders notified · {responders.length}
        </p>
        <span class="flex items-center gap-1 text-[10px] font-medium text-[#6EE7B7]">
          <span class="h-1.5 w-1.5 rounded-full bg-[#34D399] animate-live"></span>
          {ackCount} on the way
        </span>
      </div>

      <div class="mt-2.5 space-y-1.5">
        {#each responders as person, index}
          <div
            class="flex items-center gap-2.5 rounded-2xl bg-white/[0.05] px-3 py-2.5 ring-1 ring-white/[0.06]"
          >
            <span class="grid h-8 w-8 place-items-center rounded-full text-[10px] font-bold {person.tone}"
              >{person.initials}</span
            >
            <div class="min-w-0 flex-1">
              <p class="truncate text-[11.5px] font-semibold text-white">{person.name}</p>
              <p class="text-[9.5px] text-white/40">{person.role} · {person.distance}</p>
            </div>
            {#if index < ackCount}
              <span
                class="rounded-full bg-[#0E3A2A] px-2 py-1 text-[8.5px] font-bold uppercase tracking-wide text-[#6EE7B7]"
                >On the way</span
              >
            {:else}
              <span
                class="rounded-full bg-white/[0.06] px-2 py-1 text-[8.5px] font-semibold uppercase tracking-wide text-white/40"
                >Notified</span
              >
            {/if}
          </div>
        {/each}
      </div>

      <div class="mt-4 grid grid-cols-2 gap-2.5">
        <button
          type="button"
          class="flex items-center justify-center gap-2 rounded-full bg-white py-3 text-[12.5px] font-semibold text-ink transition active:scale-[0.98]"
        >
          <Phone size={15} strokeWidth={2.4} />
          Call 112
        </button>
        <button
          type="button"
          class="flex items-center justify-center gap-2 rounded-full bg-white/10 py-3 text-[12.5px] font-semibold text-white ring-1 ring-white/10 transition hover:bg-white/15 active:scale-[0.98]"
        >
          <MessageCircle size={15} strokeWidth={2.2} />
          Message
        </button>
      </div>

      <div class="mt-4 rounded-2xl bg-white/[0.035] p-3.5 ring-1 ring-white/[0.06]">
        <p class="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/35">While you wait</p>
        <ul class="mt-2 space-y-1.5">
          <li class="flex items-start gap-2 text-[10.5px] leading-snug text-white/55">
            <Check size={12} class="mt-px shrink-0 text-[#6EE7B7]" strokeWidth={2.6} />
            Stay where you are if it's safe and visible.
          </li>
          <li class="flex items-start gap-2 text-[10.5px] leading-snug text-white/55">
            <Check size={12} class="mt-px shrink-0 text-[#6EE7B7]" strokeWidth={2.6} />
            Keep your phone unlocked, sound on.
          </li>
        </ul>
      </div>

      <div class="mt-auto pt-5">
        <button
          type="button"
          onclick={endAlert}
          class="flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-[12.5px] font-semibold ring-1 transition {confirming
            ? 'bg-sos text-white ring-sos'
            : 'bg-white/[0.04] text-white/80 ring-white/10 hover:bg-white/[0.08]'}"
        >
          <ShieldCheck size={15} />
          {confirming ? 'Tap again to end alert' : "I'm safe — end alert"}
        </button>
        <p class="mt-2.5 text-center text-[9.5px] text-white/35">
          Ending the alert stops live location sharing.
        </p>
      </div>
    </div>
  {:else}
    <!-- ENDED -->
    <div class="absolute inset-0 bg-[#0B1512]"></div>
    <div
      class="pointer-events-none absolute left-1/2 top-1/4 h-72 w-72 -translate-x-1/2 rounded-full bg-[#0BA36F]/25 blur-3xl"
    ></div>

    <div class="relative flex h-full flex-col px-6 pb-8 pt-10 text-white" in:fade={{ duration: 200 }}>
      <div class="flex flex-1 flex-col items-center justify-center text-center">
        <div class="relative grid h-24 w-24 place-items-center" transition:scale={{ duration: 260 }}>
          <span class="absolute inset-0 rounded-full bg-[#0BA36F]/20 animate-breathe"></span>
          <span class="grid h-20 w-20 place-items-center rounded-full bg-[#0BA36F] shadow-lg">
            <Check size={38} strokeWidth={2.6} class="text-white" />
          </span>
        </div>

        <h2 class="mt-7 text-[26px] font-semibold tracking-[-0.03em]">You're marked safe</h2>
        <p class="mt-2 max-w-[260px] text-[12.5px] leading-relaxed text-white/55">
          Your alert has ended and live location sharing stopped. Your contacts have been notified.
        </p>

        <div class="mt-6 flex w-full max-w-[280px] divide-x divide-white/10 rounded-2xl bg-white/[0.05] py-3.5 ring-1 ring-white/10">
          <div class="flex-1 text-center">
            <p class="text-[15px] font-semibold">{elapsedLabel(Math.max(elapsed, 1))}</p>
            <p class="mt-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-white/40">Duration</p>
          </div>
          <div class="flex-1 text-center">
            <p class="text-[15px] font-semibold">{ackCount}</p>
            <p class="mt-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-white/40">Responded</p>
          </div>
          <div class="flex-1 text-center">
            <p class="text-[15px] font-semibold">{responders.length}</p>
            <p class="mt-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-white/40">Notified</p>
          </div>
        </div>
      </div>

      <button
        type="button"
        onclick={backHome}
        class="w-full rounded-full bg-white py-3.5 text-[13px] font-semibold text-ink transition active:scale-[0.98]"
      >
        Back to home
      </button>
      <p class="mt-2.5 text-center text-[10px] text-white/35">A summary was saved to your alert history.</p>
    </div>
  {/if}
</div>
