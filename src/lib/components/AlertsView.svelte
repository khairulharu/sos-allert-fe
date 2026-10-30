<script>
  import { ArrowUpRight, Radio, BadgeCheck, Info, SlidersHorizontal } from '@lucide/svelte'
  import { alertHistory } from '$lib/data.js'

  let tab = $state('all')
  const tabs = [
    { id: 'all', label: 'All' },
    { id: 'sent', label: 'Sent' },
    { id: 'received', label: 'Received' },
  ]

  const filtered = $derived(
    tab === 'all' ? alertHistory : alertHistory.filter((item) => item.type === tab),
  )

  const groups = $derived(
    filtered.reduce((acc, item) => {
      const key = item.date === 'Today' ? 'Today' : item.date.startsWith('Oct') ? 'October' : 'Earlier'
      acc[key] = acc[key] ?? []
      acc[key].push(item)
      return acc
    }, {}),
  )

  const statusTone = {
    Resolved: 'bg-[#E9F7F1] text-[#087a54]',
    Responded: 'bg-[#EAF0FF] text-[#2F5BD0]',
    Cancelled: 'bg-[#F2F3F5] text-muted',
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
      <p class="mt-1.5 text-[21px] font-semibold tracking-tight">12</p>
      <p class="text-[10px] text-muted">alerts sent</p>
    </div>
    <div class="card rounded-[20px] p-3.5">
      <p class="eyebrow">Helped</p>
      <p class="mt-1.5 text-[21px] font-semibold tracking-tight text-safe">8</p>
      <p class="text-[10px] text-muted">nearby alerts</p>
    </div>
    <div class="card rounded-[20px] p-3.5">
      <p class="eyebrow">Avg. reply</p>
      <p class="mt-1.5 text-[21px] font-semibold tracking-tight">42<span class="text-[12px] font-medium text-muted">s</span></p>
      <p class="text-[10px] text-muted">responder time</p>
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
                <span class="truncate text-[13px] font-semibold text-ink">{item.title}</span>
                {#if item.responders > 0}
                  <span class="inline-flex shrink-0 items-center gap-0.5 text-[9.5px] font-medium text-muted">
                    <BadgeCheck size={11} class="text-[#2F6BFF]" /> {item.responders}
                  </span>
                {/if}
              </span>
              <span class="mt-1 block truncate text-[11px] text-muted">{item.place}</span>
              <span class="mt-2 flex items-center gap-2">
                <span class="rounded-full px-2 py-0.5 text-[9.5px] font-semibold {statusTone[item.status]}"
                  >{item.status}</span
                >
                <span class="text-[10px] text-muted">{item.time} · {item.duration}</span>
              </span>
            </span>
          </button>
        {/each}
      </div>
    </section>
  {/each}

  <div class="mt-6 flex items-start gap-2.5 rounded-[18px] bg-white/60 p-3.5 ring-1 ring-black/[0.03]">
    <Info size={14} class="mt-0.5 shrink-0 text-muted" />
    <p class="text-[10.5px] leading-relaxed text-muted">
      History is kept for 90 days. Live locations are never stored after an alert ends.
    </p>
  </div>
</div>
