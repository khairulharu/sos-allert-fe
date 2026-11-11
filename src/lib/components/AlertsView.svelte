<script>
  import { onMount } from 'svelte'
  import { ArrowUpRight, Radio, BadgeCheck, Info, Loader } from '@lucide/svelte'
  import { sos } from '$lib/api.js'
  import { emergencyLabel, severityWord, timeAgo } from '$lib/alertMeta.js'

  const PAGE_SIZE = 20

  // `All` is gone on purpose: "every alert" is not one paged query, and merging
  // two pages would make `paging` lie. Each tab is one `role`.
  const tabs = [
    { id: 'sent', label: 'Sent' },
    { id: 'received', label: 'Received' },
  ]

  const statusFilters = [
    { id: 'all', label: 'All' },
    { id: 'active', label: 'Active' },
    { id: 'closed', label: 'Closed' },
  ]

  const statusTone = {
    TRIGGERED: 'bg-[#EAF0FF] text-[#2F5BD0]',
    ACKNOWLEDGED: 'bg-[#EAF0FF] text-[#2F5BD0]',
    RESOLVED: 'bg-[#E9F7F1] text-[#087a54]',
    CANCELLED: 'bg-[#F2F3F5] text-muted',
    EXPIRED: 'bg-[#F2F3F5] text-muted',
  }

  const statusLabel = {
    TRIGGERED: 'Active',
    ACKNOWLEDGED: 'Acknowledged',
    RESOLVED: 'Resolved',
    CANCELLED: 'Cancelled',
    EXPIRED: 'Expired',
  }

  const EMPTY_COPY = {
    sent: 'No alerts sent yet',
    received: 'No alerts received yet',
  }

  const EMPTY_HINT = {
    sent: 'SOS alerts you trigger will show up here.',
    received: 'Alerts pushed to you nearby will show up here.',
  }

  let role = $state('sent')
  let statusFilter = $state('all')
  let items = $state([])
  let page = $state(1)
  let totalPage = $state(1)
  let totalItem = $state(0)
  let loading = $state(true)
  let loadingMore = $state(false)
  let error = $state('')
  let summary = $state(null)
  let summaryError = $state(false)

  // Last response wins only if it still belongs to the current tab/filter.
  let seq = 0

  async function load({ append = false } = {}) {
    const my = ++seq
    const nextPage = append ? page + 1 : 1
    if (append) loadingMore = true
    else {
      loading = true
      items = []
    }
    error = ''
    try {
      const { items: rows, paging } = await sos.history({
        role,
        status: statusFilter === 'all' ? '' : statusFilter,
        page: nextPage,
        size: PAGE_SIZE,
      })
      if (my !== seq) return
      const fresh = (rows || []).map(normalize)
      items = append ? [...items, ...fresh] : fresh
      page = Number(paging?.page) || nextPage
      totalPage = Number(paging?.total_page) || 1
      totalItem = Number(paging?.total_item) || items.length
    } catch (e) {
      if (my !== seq) return
      error = e?.message || 'Failed to load alerts'
    } finally {
      if (my === seq) {
        loading = false
        loadingMore = false
      }
    }
  }

  async function loadSummary() {
    summaryError = false
    try {
      summary = await sos.summary()
    } catch {
      summary = null
      summaryError = true
    }
  }

  onMount(() => {
    load()
    loadSummary()
  })

  function chooseRole(next) {
    if (next === role) return
    role = next
    page = 1
    load()
  }

  function chooseStatus(next) {
    if (next === statusFilter) return
    statusFilter = next
    load()
  }

  const groups = $derived(
    items.reduce((acc, item) => {
      acc[item.dateLabel] = acc[item.dateLabel] ?? []
      acc[item.dateLabel].push(item)
      return acc
    }, {}),
  )

  const remaining = $derived(Math.max(0, totalItem - items.length))

  const sentTotal = $derived(summary ? (summary.sent?.total ?? 0) : null)
  const resolvedAnswered = $derived(summary ? (summary.responded?.resolved ?? 0) : null)
  const incomingActive = $derived(summary ? (summary.received?.active ?? 0) : null)

  function placeLabel(point) {
    if (!point) return '—'
    if (typeof point === 'string') return point
    const latitude = Number(point.latitude)
    const longitude = Number(point.longitude)
    return Number.isFinite(latitude) && Number.isFinite(longitude)
      ? `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`
      : '—'
  }

  function endedLabel(status, alert) {
    if (status === 'RESOLVED' && alert.resolved_at) return `resolved ${timeAgo(alert.resolved_at)}`
    if (status === 'CANCELLED' && alert.cancelled_at) return `cancelled ${timeAgo(alert.cancelled_at)}`
    // EXPIRED carries no timestamp of its own; the trigger time is all we have.
    return ''
  }

  function normalize(a) {
    const t = a.triggered_at ? new Date(a.triggered_at) : null
    const today = new Date()
    const dateLabel = t
      ? t.toDateString() === today.toDateString()
        ? 'Today'
        : t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : 'Earlier'
    const time = t
      ? t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : '—'
    const emergency = emergencyLabel(a.emergency_type)
    const severity = severityWord(a.severity)
    return {
      ...a,
      dateLabel,
      time,
      severity,
      emergency,
      summary: a.summary || `${emergency} alert`,
      place: placeLabel(a.latest_location || a.initial_location),
      responders: Number(a.responders_en_route) || 0,
      statusKey: a.status,
      status: statusLabel[a.status] || a.status,
      meta: severity ? `${emergency} · ${severity}` : emergency,
      ended: endedLabel(a.status, a),
    }
  }
</script>

<div class="px-5 pb-4 pt-7">
  <header>
    <div>
      <p class="text-[13px] font-medium text-muted">Safety timeline</p>
      <h1 class="mt-1 text-[26px] font-semibold tracking-[-0.035em]">Alerts</h1>
    </div>
  </header>

  <!-- summary -->
  <section class="mt-5 grid grid-cols-3 gap-2.5">
    <div class="card rounded-[20px] p-3.5">
      <p class="eyebrow">All time</p>
      <p class="mt-1.5 text-[21px] font-semibold tracking-tight">{sentTotal ?? '—'}</p>
      <p class="text-[12px] text-muted">alerts sent</p>
    </div>
    <div class="card rounded-[20px] p-3.5">
      <p class="eyebrow">Resolved</p>
      <p class="mt-1.5 text-[21px] font-semibold tracking-tight text-safe">{resolvedAnswered ?? '—'}</p>
      <p class="text-[12px] text-muted">you answered</p>
    </div>
    <div class="card rounded-[20px] p-3.5">
      <p class="eyebrow">Incoming</p>
      <p class="mt-1.5 text-[21px] font-semibold tracking-tight">{incomingActive ?? '—'}</p>
      <p class="text-[12px] text-muted">active now</p>
    </div>
  </section>

  {#if summaryError}
    <button
      type="button"
      onclick={loadSummary}
      class="mt-2 w-full rounded-[14px] px-3 py-2 text-left text-[12px] font-medium text-muted underline-offset-2 hover:underline"
    >
      Couldn't load totals · Retry
    </button>
  {/if}

  <!-- tabs -->
  <div class="mt-5 flex rounded-full bg-[#ECEEF1] p-1">
    {#each tabs as item}
      <button
        type="button"
        onclick={() => chooseRole(item.id)}
        aria-pressed={role === item.id}
        class="flex-1 rounded-full py-2 text-[13px] font-semibold transition {role === item.id
          ? 'bg-white text-ink shadow-sm'
          : 'text-muted hover:text-ink'}"
      >
        {item.label}
      </button>
    {/each}
  </div>

  <!-- status filter -->
  <div class="mt-2.5 flex items-center gap-2">
    {#each statusFilters as filter}
      <button
        type="button"
        onclick={() => chooseStatus(filter.id)}
        aria-pressed={statusFilter === filter.id}
        class="rounded-full px-3 py-1 text-[12px] font-semibold transition {statusFilter === filter.id
          ? 'bg-ink text-white'
          : 'bg-white/70 text-muted ring-1 ring-black/[0.04] hover:text-ink'}"
      >
        {filter.label}
      </button>
    {/each}
  </div>

  {#if loading}
    <div class="card mt-5 flex items-center justify-center gap-2.5 px-4 py-10 text-[13.5px] font-medium text-muted">
      <Loader size={15} class="animate-spin" />
      Loading alerts…
    </div>
  {:else if error && items.length === 0}
    <div class="card mt-5 px-4 py-10 text-center" role="alert">
      <p class="text-[13.5px] font-semibold text-ink">Couldn't load alerts</p>
      <p class="mt-1 text-[12.5px] text-muted">{error}</p>
      <button
        type="button"
        onclick={() => load()}
        class="mt-3 rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-ink ring-1 ring-black/5 transition hover:bg-[#FAFBFC] active:scale-[0.98]"
      >
        Retry
      </button>
    </div>
  {:else if items.length === 0}
    <div class="card mt-5 px-4 py-10 text-center">
      <p class="text-[13.5px] font-semibold text-ink">
        {statusFilter === 'all'
          ? EMPTY_COPY[role]
          : `No ${statusFilter} alerts in ${role === 'sent' ? 'sent' : 'received'}`}
      </p>
      <p class="mt-1 text-[12.5px] text-muted">
        {statusFilter === 'all' ? EMPTY_HINT[role] : 'Try another filter.'}
      </p>
    </div>
  {:else}
    {#each Object.entries(groups) as [label, group]}
      <section class="mt-6">
        <div class="flex items-center justify-between px-0.5">
          <h2 class="eyebrow text-ink/60">{label}</h2>
          <span class="text-[12px] font-medium text-muted">{group.length} alert{group.length > 1 ? 's' : ''}</span>
        </div>

        <div class="card mt-2.5 divide-y divide-line/80 overflow-hidden">
          {#each group as item (item.alert_id)}
            <div class="flex items-start gap-3 px-4 py-4">
              <span
                class="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-2xl {role === 'sent'
                  ? 'bg-[#FFECEB] text-sos'
                  : 'bg-[#E9F7F1] text-safe'}"
              >
                {#if role === 'sent'}
                  <ArrowUpRight size={17} strokeWidth={2.3} />
                {:else}
                  <Radio size={17} strokeWidth={2.1} />
                {/if}
              </span>

              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-1.5">
                  <span class="truncate text-[14px] font-semibold text-ink">{item.summary}</span>
                  {#if item.responders > 0}
                    <span class="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-muted">
                      <BadgeCheck size={11} class="text-[#2F6BFF]" /> {item.responders}
                    </span>
                  {/if}
                </span>
                <span class="mt-1 block truncate text-[12.5px] text-muted">
                  {role === 'received' && item.sender?.name ? `${item.sender.name} · ` : ''}{item.meta}
                </span>
                <span class="mt-2 flex flex-wrap items-center gap-2">
                  <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold {statusTone[item.statusKey] || statusTone.CANCELLED}"
                    >{item.status}</span
                  >
                  <span class="text-[12px] text-muted">{item.time} · {item.place}</span>
                  {#if item.ended}
                    <span class="text-[12px] text-muted">· {item.ended}</span>
                  {/if}
                </span>
              </span>
            </div>
          {/each}
        </div>
      </section>
    {/each}

    {#if error}
      <p class="mt-4 text-center text-[12.5px] text-sos" role="alert">{error}</p>
    {/if}

    {#if page < totalPage}
      <button
        type="button"
        onclick={() => load({ append: true })}
        disabled={loadingMore}
        aria-busy={loadingMore}
        class="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-white px-4 py-3 text-[13px] font-semibold text-ink ring-1 ring-black/5 transition hover:bg-[#FAFBFC] active:scale-[0.99] disabled:opacity-60"
      >
        {#if loadingMore}
          <Loader size={14} class="animate-spin" /> Loading…
        {:else}
          Load more{remaining > 0 ? ` · ${remaining} left` : ''}
        {/if}
      </button>
    {/if}
  {/if}

  <div class="mt-6 flex items-start gap-2.5 rounded-[18px] bg-white/60 p-3.5 ring-1 ring-black/[0.03]">
    <Info size={14} class="mt-0.5 shrink-0 text-muted" />
    <p class="text-[12px] leading-relaxed text-muted">
      Alerts are kept on the server. Other people's locations stay approximate until you respond.
    </p>
  </div>
</div>
