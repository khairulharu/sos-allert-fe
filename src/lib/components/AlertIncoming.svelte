<script>
  import { fade, fly } from 'svelte/transition'
  import {
    X,
    MapPin,
    HeartPulse,
    Clock,
    Navigation,
    Radio,
    ShieldAlert,
    Loader2,
  } from '@lucide/svelte'
  import MapCard from './MapCard.svelte'
  import { trap } from '$lib/focus.js'
  import {
    emergencyLabel,
    initialsFor,
    responderMeta,
    timeAgo,
    distanceMeters,
    formatDistance,
  } from '$lib/alertMeta.js'

  let {
    alert = null,
    own = null,
    live = null,
    responded = null,
    youId = null,
    busy = false,
    error = '',
    onclose,
    onrespond,
  } = $props()

  // A responder watching an open alert gets the newest classification over the
  // tracking socket (ALERT_TRIAGE). Prefer it over the payload the inbox was
  // polled with, which is frozen at fan-out time.
  const track = $derived(live?.alertId && live.alertId === alert?.alert_id ? live : null)
  const liveTriage = $derived(track?.triage || null)
  const senderName = $derived(alert?.sender?.name || 'Neighbor')
  const senderInitials = $derived(initialsFor(senderName))
  const typeLabel = $derived(emergencyLabel(liveTriage?.emergency_type || alert?.emergency_type))
  const location = $derived(alert?.latest_location || alert?.initial_location || null)
  const distance = $derived(distanceMeters(own, location))
  const distanceText = $derived(distance != null ? `±${formatDistance(distance)}` : 'nearby')
  const summary = $derived(liveTriage?.summary || alert?.summary || `${typeLabel} emergency`)
  const reclassified = $derived(
    !!liveTriage?.emergency_type && liveTriage.emergency_type !== alert?.emergency_type,
  )
  const respondedLine = $derived(
    [
      responded?.eta ? `ETA ${responded.eta}` : '',
      responded?.distance ? `${responded.distance} away` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  )

  // Other responders on this alert, from RESPONDER_ADDED frames on this
  // responder's channel. The caller is excluded and rendered from `responded`
  // instead: their socket connects after POST /respond, so their own frame is
  // usually missed.
  const othersOnWay = $derived(
    (track?.responders || []).filter((person) => !youId || person.user_id !== youId),
  )
  const onTheWayCount = $derived(othersOnWay.length + (responded ? 1 : 0))
  const statusLabel = $derived(
    responded
      ? 'You are on the way'
      : alert?.status === 'ACKNOWLEDGED'
        ? 'Responder en route'
        : 'Waiting for help',
  )

  const details = $derived([
    { icon: MapPin, label: 'Distance', value: distanceText },
    { icon: HeartPulse, label: 'Type', value: typeLabel },
    { icon: Clock, label: 'Reported', value: timeAgo(alert?.triggered_at) },
  ])
</script>

<div class="absolute inset-0 z-[45]">
  <div
    aria-hidden="true"
    onclick={onclose}
    class="absolute inset-0 h-full w-full bg-ink/40 backdrop-blur-[3px]"
    transition:fade={{ duration: 180 }}
  ></div>

  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="incoming-alert-title"
    tabindex="-1"
    use:trap={{ initial: '[data-autofocus]' }}
    onkeydown={(e) => {
      if (e.key === 'Escape') onclose?.()
    }}
    class="absolute inset-x-0 bottom-0 overflow-hidden rounded-t-[32px] bg-[#F7F8FA] shadow-[0_-20px_60px_-20px_rgba(13,15,19,0.45)]"
    transition:fly={{ y: 420, duration: 320 }}
  >
    <div class="flex justify-center pb-1 pt-2.5">
      <span class="h-1 w-10 rounded-full bg-ink/15"></span>
    </div>

    <div class="max-h-[86vh] overflow-y-auto px-5 pb-6 pt-2 no-scrollbar">
      <div class="flex items-center justify-between">
        <span
          class="inline-flex items-center gap-1.5 rounded-full bg-[#FFECEB] px-3 py-1.5 text-[12px] font-bold uppercase tracking-[0.14em] text-sos"
        >
          <ShieldAlert size={12} strokeWidth={2.4} />
          Nearby SOS
        </span>
        <button
          type="button"
          aria-label="Dismiss alert"
          onclick={onclose}
          class="grid h-11 w-11 place-items-center rounded-full bg-white text-ink/60 ring-1 ring-black/5 transition hover:text-ink active:scale-95"
        >
          <X size={15} />
        </button>
      </div>

      <div class="mt-4 flex items-center gap-3">
        <span class="relative">
          <span
            class="grid h-12 w-12 place-items-center rounded-full bg-[#F2C879] text-[14px] font-bold text-[#6b4a10]"
            >{senderInitials}</span
          >
          <span
            class="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-sos ring-2 ring-[#F7F8FA]"
          >
            <span class="h-1.5 w-1.5 rounded-full bg-white animate-pulse"></span>
          </span>
        </span>
        <div class="min-w-0 flex-1">
          <h2 id="incoming-alert-title" class="truncate text-[17px] font-semibold tracking-[-0.02em]">{senderName}<span class="sr-only"> — {typeLabel} SOS alert</span></h2>
          <p class="mt-0.5 text-[12.5px] text-muted">
            {alert?.masked ? 'Approximate location' : 'Live location'} · {statusLabel}
          </p>
        </div>
        <span
          class="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-ink/60 ring-1 ring-black/5"
          >{distanceText}</span
        >
      </div>

      <p class="mt-3 text-[13px] leading-relaxed text-ink/70">
        {senderName} triggered a nearby SOS: {summary}. Your live location is shared only if you
        respond.
      </p>

      {#if reclassified}
        <p
          class="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-ink/60 ring-1 ring-black/5"
        >
          <Radio size={11} class="text-[#E7A93B]" />
          Re-classified from the audio: {typeLabel}
        </p>
      {/if}

      <div class="mt-4">
        <MapCard
          height="h-[132px]"
          showFooter={false}
          showControls={false}
          showRadiusDefault={false}
          radiusLabel={distanceText}
          own={own}
          focus={location}
          live={track}
        />
      </div>

      <div class="mt-3.5 grid grid-cols-3 gap-2">
        {#each details as detail}
          {@const Icon = detail.icon}
          <div class="card rounded-2xl p-2.5">
            <Icon size={13} class="text-muted" />
            <p class="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
              {detail.label}
            </p>
            <p class="mt-0.5 text-[12px] font-semibold text-ink">{detail.value}</p>
          </div>
        {/each}
      </div>

      {#if onTheWayCount > 0}
        <div class="mt-3.5">
          <p class="px-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            On the way · {onTheWayCount}
          </p>
          <div class="card mt-2 divide-y divide-line/80 overflow-hidden">
            {#if responded}
              <div class="flex items-center gap-2.5 px-3.5 py-2.5">
                <span
                  class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#E9F7F1] text-[11px] font-bold text-[#087a54]"
                  >You</span
                >
                <div class="min-w-0 flex-1">
                  <p class="truncate text-[13px] font-semibold text-ink">You</p>
                  {#if respondedLine}
                    <p class="mt-0.5 truncate text-[12px] text-muted">{respondedLine}</p>
                  {/if}
                </div>
                <span
                  class="shrink-0 rounded-full bg-[#E9F7F1] px-2 py-1 text-[11px] font-semibold text-[#087a54]"
                  >On the way</span
                >
              </div>
            {/if}
            {#each othersOnWay as person (person.user_id)}
              <div class="flex items-center gap-2.5 px-3.5 py-2.5">
                <span
                  class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#F7E7C2] text-[11px] font-bold text-[#6b4a10]"
                  >{initialsFor(person.name || 'Responder')}</span
                >
                <div class="min-w-0 flex-1">
                  <p class="truncate text-[13px] font-semibold text-ink">
                    {person.name || 'Responder'}
                  </p>
                  {#if responderMeta(person)}
                    <p class="mt-0.5 truncate text-[12px] text-muted">{responderMeta(person)}</p>
                  {/if}
                </div>
                <span
                  class="shrink-0 rounded-full bg-[#F5F6F8] px-2 py-1 text-[11px] font-semibold text-ink/55"
                  >On the way</span
                >
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#if error}
        <p class="mt-3 rounded-2xl bg-[#FFECEB] px-3.5 py-2.5 text-[13px] font-medium text-[#b3241d]">
          {error}
        </p>
      {/if}

      <div class="mt-4 space-y-1.5">
        {#if responded}
          <div class="rounded-2xl bg-[#E9F7F1] px-3.5 py-3 ring-1 ring-[#0ba36f]/15">
            <p class="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#087a54]">
              <Navigation size={13} strokeWidth={2.4} />
              You're on the way{respondedLine ? ` · ${respondedLine}` : ''}
            </p>
            <p class="mt-1 text-[12px] leading-snug text-[#087a54]/80">
              Your live location is shared with them, and this screen follows the alert until it
              ends.
            </p>
          </div>
          <button
            type="button"
            data-autofocus
            onclick={onclose}
            class="w-full rounded-full py-3 text-[13px] font-semibold text-ink/60 transition hover:text-ink"
          >
            Close
          </button>
        {:else}
          <button
            type="button"
            data-autofocus
            onclick={onrespond}
            disabled={busy}
            aria-busy={busy}
            class="flex w-full items-center justify-center gap-2 rounded-full bg-sos py-3.5 text-[14px] font-semibold text-white shadow-[0_12px_28px_-10px_rgba(255,59,48,0.7)] transition active:scale-[0.98] disabled:opacity-70"
          >
            {#if busy}
              <Loader2 size={15} class="animate-spin" />
              Sending response…
            {:else}
              <Navigation size={15} strokeWidth={2.4} />
              I'm coming
            {/if}
          </button>
          <button
            type="button"
            onclick={onclose}
            class="w-full rounded-full py-3 text-[13px] font-semibold text-ink/60 transition hover:text-ink"
          >
            Not available right now
          </button>
        {/if}
      </div>

      <p class="mt-2 text-center text-[11px] leading-relaxed text-muted">
        Only respond if it's safe to do so. Never put yourself at risk.
      </p>
    </div>
  </div>
</div>
