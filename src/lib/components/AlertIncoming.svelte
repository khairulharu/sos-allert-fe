<script>
  import { fade, fly } from 'svelte/transition'
  import { X, MapPin, HeartPulse, Clock, Navigation, ShieldAlert } from '@lucide/svelte'
  import MapCard from './MapCard.svelte'

  let { onclose, onrespond } = $props()

  const details = [
    { icon: MapPin, label: 'Distance', value: '400 m away' },
    { icon: HeartPulse, label: 'Type', value: 'Medical help' },
    { icon: Clock, label: 'Reported', value: '1 min ago' },
  ]
</script>

<div class="absolute inset-0 z-[45]" role="dialog" aria-modal="true" aria-label="Nearby SOS alert">
  <button
    type="button"
    aria-label="Dismiss alert"
    onclick={onclose}
    class="absolute inset-0 h-full w-full bg-ink/40 backdrop-blur-[3px]"
    transition:fade={{ duration: 180 }}
  ></button>

  <div
    class="absolute inset-x-0 bottom-0 overflow-hidden rounded-t-[32px] bg-[#F7F8FA] shadow-[0_-20px_60px_-20px_rgba(13,15,19,0.45)]"
    transition:fly={{ y: 420, duration: 320 }}
  >
    <div class="flex justify-center pb-1 pt-2.5">
      <span class="h-1 w-10 rounded-full bg-ink/15"></span>
    </div>

    <div class="max-h-[86vh] overflow-y-auto px-5 pb-6 pt-2 no-scrollbar">
      <div class="flex items-center justify-between">
        <span
          class="inline-flex items-center gap-1.5 rounded-full bg-[#FFECEB] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-sos"
        >
          <ShieldAlert size={12} strokeWidth={2.4} />
          Nearby SOS
        </span>
        <button
          type="button"
          aria-label="Close"
          onclick={onclose}
          class="grid h-8 w-8 place-items-center rounded-full bg-white text-ink/50 ring-1 ring-black/5 transition hover:text-ink active:scale-95"
        >
          <X size={15} />
        </button>
      </div>

      <div class="mt-4 flex items-center gap-3">
        <span class="relative">
          <span class="grid h-12 w-12 place-items-center rounded-full bg-[#F2C879] text-[14px] font-bold text-[#6b4a10]"
            >SM</span
          >
          <span class="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-sos ring-2 ring-[#F7F8FA]">
            <span class="h-1.5 w-1.5 rounded-full bg-white animate-pulse"></span>
          </span>
        </span>
        <div class="min-w-0 flex-1">
          <h2 class="text-[17px] font-semibold tracking-[-0.02em]">Sarah Mitchell</h2>
          <p class="mt-0.5 text-[11px] text-muted">Neighbor · Verified responder</p>
        </div>
        <span class="rounded-full bg-white px-2.5 py-1 text-[9.5px] font-semibold text-ink/60 ring-1 ring-black/5"
          >400 m</span
        >
      </div>

      <p class="mt-3 text-[12px] leading-relaxed text-ink/70">
        Sarah triggered an SOS nearby and needs medical help. Your live location is shared only if you
        respond.
      </p>

      <div class="mt-4">
        <MapCard height="h-[132px]" showFooter={false} radiusLabel="400 m from you" />
      </div>

      <div class="mt-3.5 grid grid-cols-3 gap-2">
        {#each details as detail}
          {@const Icon = detail.icon}
          <div class="card rounded-2xl p-2.5">
            <Icon size={13} class="text-muted" />
            <p class="mt-1.5 text-[8.5px] font-semibold uppercase tracking-[0.1em] text-muted">{detail.label}</p>
            <p class="mt-0.5 text-[10.5px] font-semibold text-ink">{detail.value}</p>
          </div>
        {/each}
      </div>

      <div class="mt-4 space-y-1.5">
        <button
          type="button"
          onclick={onrespond}
          class="flex w-full items-center justify-center gap-2 rounded-full bg-sos py-3.5 text-[13px] font-semibold text-white shadow-[0_12px_28px_-10px_rgba(255,59,48,0.7)] transition active:scale-[0.98]"
        >
          <Navigation size={15} strokeWidth={2.4} />
          I'm on my way
        </button>
        <button
          type="button"
          onclick={onclose}
          class="w-full rounded-full py-3 text-[12px] font-semibold text-ink/50 transition hover:text-ink"
        >
          Not available right now
        </button>
      </div>

      <p class="mt-2 text-center text-[9.5px] leading-relaxed text-muted/80">
        Only respond if it's safe to do so. Never put yourself at risk.
      </p>
    </div>
  </div>
</div>
