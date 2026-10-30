<script>
  import { Search, Plus, Phone, MessageCircle, BadgeCheck, MapPin, ChevronRight } from '@lucide/svelte'
  import { contacts, responders, user } from '$lib/data.js'

  let tab = $state('contacts')
  let query = $state('')

  const list = $derived(
    (tab === 'contacts' ? contacts : responders).filter((person) =>
      person.name.toLowerCase().includes(query.toLowerCase().trim()),
    ),
  )
</script>

<div class="px-5 pb-4 pt-7">
  <header class="flex items-start justify-between">
    <div>
      <p class="text-[12px] font-medium text-muted">Your safety circle</p>
      <h1 class="mt-1 text-[26px] font-semibold tracking-[-0.035em]">Contacts</h1>
    </div>
    <button
      type="button"
      class="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-[11px] font-semibold text-white transition active:scale-95"
    >
      <Plus size={14} strokeWidth={2.6} />
      Add
    </button>
  </header>

  <!-- search -->
  <div class="relative mt-5">
    <Search size={16} class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
    <input
      type="search"
      bind:value={query}
      placeholder="Search people"
      aria-label="Search contacts"
      class="w-full rounded-full bg-white py-2.5 pl-10 pr-4 text-[12.5px] font-medium text-ink outline-none ring-1 ring-black/5 placeholder:text-muted/80 focus:ring-2 focus:ring-ink/15"
    />
  </div>

  <!-- segment -->
  <div class="mt-4 flex rounded-full bg-[#ECEEF1] p-1">
    <button
      type="button"
      onclick={() => (tab = 'contacts')}
      aria-pressed={tab === 'contacts'}
      class="flex-1 rounded-full py-2 text-[11.5px] font-semibold transition {tab === 'contacts'
        ? 'bg-white text-ink shadow-sm'
        : 'text-muted hover:text-ink'}"
    >
      Emergency contacts
    </button>
    <button
      type="button"
      onclick={() => (tab = 'nearby')}
      aria-pressed={tab === 'nearby'}
      class="flex-1 rounded-full py-2 text-[11.5px] font-semibold transition {tab === 'nearby'
        ? 'bg-white text-ink shadow-sm'
        : 'text-muted hover:text-ink'}"
    >
      Nearby · 4
    </button>
  </div>

  {#if tab === 'nearby'}
    <div class="card mt-4 overflow-hidden">
      <div class="relative h-[92px] bg-[#E9EDF0]">
        <svg class="h-full w-full" viewBox="0 0 400 92" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <rect width="400" height="92" fill="#EAEEF1" />
          <g fill="#DFE4E8">
            <rect x="10" y="8" width="52" height="26" rx="4" />
            <rect x="76" y="6" width="40" height="30" rx="4" />
            <rect x="136" y="10" width="58" height="24" rx="4" />
            <rect x="212" y="6" width="44" height="28" rx="4" />
            <rect x="274" y="10" width="60" height="24" rx="4" />
            <rect x="350" y="6" width="46" height="30" rx="4" />
            <rect x="10" y="58" width="44" height="26" rx="4" />
            <rect x="72" y="56" width="56" height="30" rx="4" />
            <rect x="144" y="58" width="38" height="26" rx="4" />
            <rect x="198" y="56" width="58" height="30" rx="4" />
            <rect x="272" y="58" width="42" height="28" rx="4" />
            <rect x="332" y="56" width="62" height="30" rx="4" />
          </g>
          <g stroke="#FBFCFD" stroke-width="10">
            <path d="M-10 46 H410" />
            <path d="M62 -10 V100" />
            <path d="M126 -10 V100" />
            <path d="M192 -10 V100" />
            <path d="M264 -10 V100" />
            <path d="M330 -10 V100" />
          </g>
          <circle cx="200" cy="46" r="34" fill="#FF3B30" opacity="0.06" />
          <circle cx="200" cy="46" r="34" fill="none" stroke="#FF3B30" stroke-opacity="0.3" stroke-dasharray="4 5" />
          <circle cx="200" cy="46" r="15" fill="#2F6BFF" opacity="0.14" />
          <circle cx="200" cy="46" r="8" fill="#fff" />
          <circle cx="200" cy="46" r="5" fill="#2F6BFF" />
          <circle cx="164" cy="32" r="6" fill="#E7A93B" stroke="#fff" stroke-width="2" />
          <circle cx="236" cy="56" r="6" fill="#43A98A" stroke="#fff" stroke-width="2" />
          <circle cx="222" cy="26" r="6" fill="#6E8FE8" stroke="#fff" stroke-width="2" />
        </svg>
        <span
          class="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-semibold text-ink shadow-sm ring-1 ring-black/5 backdrop-blur"
        >
          <MapPin size={10} class="text-sos" />
          Within 1 km
        </span>
      </div>
      <div class="flex items-center justify-between px-4 py-3">
        <p class="text-[11px] font-medium text-muted">
          Live responders around <span class="font-semibold text-ink">{user.area.split(',')[0]}</span>
        </p>
        <span class="flex items-center gap-1 text-[10px] font-semibold text-safe">
          <span class="h-1.5 w-1.5 rounded-full bg-safe animate-live"></span>Live
        </span>
      </div>
    </div>
  {/if}

  <!-- list -->
  <section class="mt-5">
    <div class="flex items-center justify-between px-0.5">
      <h2 class="eyebrow text-ink/50">{tab === 'contacts' ? 'Trusted people' : 'Available now'}</h2>
      <span class="text-[10px] font-medium text-muted">{list.length} people</span>
    </div>

    <div class="card mt-2.5 divide-y divide-line/80 overflow-hidden">
      {#each list as person}
        <div class="flex items-center gap-3 px-4 py-3.5">
          <span class="relative shrink-0">
            <span class="grid h-10 w-10 place-items-center rounded-full text-[12px] font-bold {person.tone}"
              >{person.initials}</span
            >
            {#if tab === 'nearby'}
              <span class="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-safe ring-2 ring-white"></span>
            {/if}
          </span>

          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1">
              <p class="truncate text-[13px] font-semibold text-ink">{person.name}</p>
              {#if person.verified}
                <BadgeCheck size={13} class="shrink-0 text-[#2F6BFF]" strokeWidth={2.3} />
              {/if}
              {#if person.favorite}
                <span class="rounded-full bg-[#FFF6E5] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-[#9a6b12]"
                  >Primary</span
                >
              {/if}
            </div>
            <p class="mt-0.5 truncate text-[10.5px] text-muted">
              {person.relation ?? `${person.role} · ${person.distance}`}
            </p>
          </div>

          <div class="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              aria-label="Message {person.name}"
              class="grid h-8 w-8 place-items-center rounded-full bg-[#F5F6F8] text-ink/60 transition hover:bg-ink hover:text-white active:scale-95"
            >
              <MessageCircle size={14} />
            </button>
            <button
              type="button"
              aria-label="Call {person.name}"
              class="grid h-8 w-8 place-items-center rounded-full bg-[#E9F7F1] text-safe transition hover:bg-safe hover:text-white active:scale-95"
            >
              <Phone size={13.5} />
            </button>
          </div>
        </div>
      {:else}
        <div class="px-4 py-10 text-center">
          <p class="text-[12.5px] font-semibold text-ink">No people found</p>
          <p class="mt-1 text-[11px] text-muted">Try a different name.</p>
        </div>
      {/each}
    </div>
  </section>

  <button
    type="button"
    class="mt-4 flex w-full items-center gap-3 rounded-[20px] border border-dashed border-ink/15 bg-white/40 px-4 py-3.5 text-left transition hover:bg-white"
  >
    <span class="grid h-10 w-10 place-items-center rounded-full bg-white text-ink/50 ring-1 ring-black/5">
      <Plus size={18} />
    </span>
    <span class="flex-1">
      <span class="block text-[12.5px] font-semibold text-ink">Invite someone you trust</span>
      <span class="mt-0.5 block text-[10.5px] text-muted">They'll be alerted when you need help.</span>
    </span>
    <ChevronRight size={16} class="text-muted" />
  </button>
</div>
