<script>
  import { onMount } from 'svelte'
  import { ArrowUpRight, Radio, BadgeCheck, Info, SlidersHorizontal, Loader } from '@lucide/svelte'
  import { sos } from '$lib/api.js'
  import { session } from '$lib/stores.js'

  let tab = $state('all')
  let loading = $state(true)
  let error = $state('')
  let alerts = $state([])

  const tabs = [
    { id: 'all', label: 'All' },
    { id: 'sent', label: 'Sent' },
    { id: 'received', label: 'Received' },
  ]

  const statusTone = {
    TRIGGERED: 'bg-[#EAF0FF] text-[#2F5BD0]',
    ACKNOWLEDGED: 'bg-[#EAF0FF] text-[#2F5BD0]',
    RESOLVED: 'bg-[#E9F7F1] text-[#087a54]',
    CANCELLED: 'bg-[#F2F3F5] text-muted',
  }

  const statusLabel = {
    TRIGGERED: 'Active',
    ACKNOWLEDGED: 'Acknowledged',
    RESOLVED: 'Resolved',
    CANCELLED: 'Cancelled',
  }

  const filtered = $derived(
    tab === 'all' ? alerts : alerts.filter((item) => item.type === tab),
  )

  const groups = $derived(
    filtered.reduce((acc, item) => {
      acc[item.dateLabel] = acc[item.dateLabel] ?? []
      acc[item.dateLabel].push(item)
      return acc
    }, {}),
  )

  const sentCount = $derived(alerts.filter((a) => a.type === 'sent').length)
  const helpedCount = $derived(alerts.filter((a) => a.statusKey === 'RESOLVED').length)

  onMount(async () => {
    try {
      const [active, inbox] = await Promise.all([
        sos.active().catch(() => []),
        sos.inbox().catch(() => []),
      ])
      const seen = new Set()
      alerts = [...(active || []), ...(inbox || [])]
        .filter((a) => (a && a.alert_id && !seen.has(a.alert_id) ? (seen.add(a.alert_id), true) : false))
        .map(normalize)
    } catch (e) {
      error = e?.message || 'Failed to load alerts'
    } finally {
      loading = false
    }
  })

  function normalize(a) {
    const isSelf = a.sender?.id === $session?.user?.id
    const type = isSelf ? 'sent' : 'received'
    const t = a.triggered_at ? new Date(a.triggered_at) : null
    const today = new Date()
    const dateLabel = t
      ? t.toDateString() === today.toDateString()
        ? 'Today'
        : t.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : 'Earlier'
    const time = t
      ? t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      : '—'
    const severity = a.severity != null ? `${Math.round(Number(a.severity) * 100)}%` : '—'
    const emergency = a.emergency_type ? a.emergency_type.replace(/_/g, ' ') : 'SOS'
    return {
      ...a,
      type,
      dateLabel,
      time,
      severity,
      emergency,
      summary: a.summary || `${emergency} alert`,
      place: a.initial_location || a.latest_location || '—',
      responders: Number(a.responders_en_route) || 0,
      statusKey: a.status,
      status: statusLabel[a.status] || a.status,
      meta: `${emergency} · severity ${severity}`,
    }
  }
</script>

<div class="px-5 pb-4 pt-7">
  <header class="flex items-start justify-between">
    <div>
      <p class="text-[12px] font-medium text-muted">Safety timeline</p>
      <h1 class="mt-1 text-[26px] font-semibold tracking-[-0.035em]">Alerts</h1>
    </div>
    <button
      type="button"
      aria-label="Filter alerts"
      class="grid h-9 w-9 place-items-center rounded-full bg-white text-ink/60 ring-1 ring-black/5 transition hover:text-ink active:scale-95"
    >
      <SlidersHorizontal size={16} />
    </button>
  </header>

  <!-- summary -->
  <section class="mt-5 grid grid-cols-3 gap-2.5">
    <div class="card rounded-[20px] p-3.5">
      <p class="eyebrow">All time</p>
      <p class="mt-1.5 text-[21px] font-semibold tracking-tight">{sentCount}</p>
      <p class="text-[10px] text-muted">alerts sent</p>
    </div>
    <div class="card rounded-[20px] p-3.5">
      <p class="eyebrow">Helped</p>
      <p class="mt-1.5 text-[21px] font-semibold tracking-tight text-safe">{helpedCount}</p>
      <p class="text-[10px] text-muted">resolved alerts</p>
    </div>
    <div class="card rounded-[20px] p-3.5">
      <p class="eyebrow">Active</p>
      <p class="mt-1.5 text-[21px] font-semibold tracking-tight">{alerts.filter((a) => a.type === 'received' && a.statusKey === 'TRIGGERED').length}</p>
      <p class="text-[10px] text-muted">nearby alerts</p>
    </div>
  </section>

  <!-- tabs -->
  <div class="mt-5 flex rounded-full bg-[#ECEEF1] p-1">
    {#each tabs as item}
      <button
        type="button"
        onclick={() => (tab = item.id)}
        aria-pressed={tab === item.id}
        class="flex-1 rounded-full py-2 text-[11.5px] font-semibold transition {tab === item.id
          ? 'bg-white text-ink shadow-sm'
          : 'text-muted hover:text-ink'}"
      >
        {item.label}
      </button>
    {/each}
  </div>

  {#if loading}
    <div class="card mt-5 flex items-center justify-center gap-2.5 px-4 py-10 text-[12.5px] font-medium text-muted">
      <Loader size={15} class="animate-spin" />
      Loading alerts…
    </div>
  {:else if error}
    <div class="card mt-5 px-4 py-10 text-center">
      <p class="text-[12.5px] font-semibold text-ink">Couldn't load alerts</p>
      <p class="mt-1 text-[11px] text-muted">{error}</p>
    </div>
  {:else if Object.keys(groups).length === 0}
    <div class="card mt-5 px-4 py-10 text-center">
      <p class="text-[12.5px] font-semibold text-ink">No alerts yet</p>
      <p class="mt-1 text-[11px] text-muted">SOS alerts will show up here.</p>
    </div>
  {:else}
    {#each Object.entries(groups) as [label, items]}
      <section class="mt-6">
        <div class="flex items-center justify-between px-0.5">
          <h2 class="eyebrow text-ink/50">{label}</h2>
          <span class="text-[10px] font-medium text-muted">{items.length} alert{items.length > 1 ? 's' : ''}</span>
        </div>

        <div class="card mt-2.5 divide-y divide-line/80 overflow-hidden">
          {#each items as item}
            <button
              type="button"
              class="flex w-full items-start gap-3 px-4 py-4 text-left transition hover:bg-[#FAFBFC]"
            >
              <span
                class="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-2xl {item.type === 'sent'
                  ? 'bg-[#FFECEB] text-sos'
                  : 'bg-[#E9F7F1] text-safe'}"
              >
                {#if item.type === 'sent'}
                  <ArrowUpRight size={17} strokeWidth={2.3} />
                {:else}
                  <Radio size={17} strokeWidth={2.1} />
                {/if}
              </span>

              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-1.5">
                  <span class="truncate text-[13px] font-semibold text-ink">{item.summary}</span>
                  {#if item.responders > 0}
                    <span class="inline-flex shrink-0 items-center gap-0.5 text-[9.5px] font-medium text-muted">
                      <BadgeCheck size={11} class="text-[#2F6BFF]" /> {item.responders}
                    </span>
                  {/if}
                </span>
                <span class="mt-1 block truncate text-[11px] text-muted">
                  {item.sender?.name ? `${item.sender.name} · ` : ''}{item.meta}
                </span>
                <span class="mt-2 flex items-center gap-2">
                  <span class="rounded-full px-2 py-0.5 text-[9.5px] font-semibold {statusTone[item.statusKey]}"
                    >{item.status}</span
                  >
                  <span class="text-[10px] text-muted">{item.time} · {item.place}</span>
                </span>
              </span>
            </button>
          {/each}
        </div>
      </section>
    {/each}
  {/if}

  <div class="mt-6 flex items-start gap-2.5 rounded-[18px] bg-white/60 p-3.5 ring-1 ring-black/[0.03]">
    <Info size={14} class="mt-0.5 shrink-0 text-muted" />
    <p class="text-[10.5px] leading-relaxed text-muted">
      History is kept for 90 days. Live locations are never stored after an alert ends.
    </p>
  </div>
</div>
