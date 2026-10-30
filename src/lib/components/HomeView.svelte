<script>
  import {
    Bell,
    ChevronDown,
    ChevronRight,
    ShieldCheck,
    MapPin,
    Phone,
    Send,
    Users,
    BadgeCheck,
    ArrowUpRight,
    Radio,
    X,
    Siren,
  } from '@lucide/svelte'
  import MapCard from './MapCard.svelte'
  import { user, responders, alertHistory } from '$lib/data.js'

  let { onnavigate, onviewalert, showIncoming = true, ondismissincoming, onnotify } = $props()

  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const today = now.toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  const quickActions = [
    { id: 'call', label: 'Call 112', hint: 'Emergency', icon: Phone, tone: 'bg-[#FFECEB] text-sos' },
    { id: 'share', label: 'Share location', hint: 'Live 60 min', icon: Send, tone: 'bg-[#EAF0FF] text-[#2F6BFF]' },
    { id: 'contacts', label: 'Contacts', hint: '4 people', icon: Users, tone: 'bg-[#E9F7F1] text-safe' },
  ]

  function runAction(id) {
    if (id === 'contacts') {
      onnavigate?.('contacts')
    } else if (id === 'call') {
      onnotify?.('Calling emergency services · 112')
    } else {
      onnotify?.('Live location link copied — active for 60 min.')
    }
  }
</script>

<div class="px-5 pb-4 pt-6">
  <!-- top bar -->
  <header class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <span class="relative grid h-8 w-8 place-items-center rounded-[11px] bg-ink">
        <span class="absolute inset-0 rounded-[11px] bg-gradient-to-br from-white/20 to-transparent"></span>
        <Siren size={16} class="relative text-white" strokeWidth={2.4} />
      </span>
      <div class="leading-none">
        <p class="text-[13px] font-bold tracking-[-0.01em]">sos<span class="text-sos">.</span>alert</p>
        <p class="mt-1 text-[9px] font-medium uppercase tracking-[0.14em] text-muted">Community safety</p>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <button
        type="button"
        aria-label="Notifications"
        class="relative grid h-9 w-9 place-items-center rounded-full bg-white text-ink/70 ring-1 ring-black/5 transition hover:text-ink active:scale-95"
      >
        <Bell size={17} strokeWidth={2} />
        <span class="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-sos ring-2 ring-white"></span>
      </button>
      <button
        type="button"
        aria-label="Open profile"
        onclick={() => onnavigate?.('profile')}
        class="grid h-9 w-9 place-items-center rounded-full bg-[#1F2937] text-[11px] font-bold text-white ring-2 ring-white transition active:scale-95"
        >{user.initials}</button
      >
    </div>
  </header>

  <!-- greeting -->
  <div class="mt-5">
    <p class="text-[12px] font-medium text-muted">{today}</p>
    <h1 class="mt-1 text-[26px] font-semibold leading-[1.15] tracking-[-0.035em]">
      {greeting}, {user.name}
    </h1>
    <button
      type="button"
      class="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-ink/80 ring-1 ring-black/5 transition hover:text-ink active:scale-95"
    >
      <MapPin size={12} class="text-sos" strokeWidth={2.6} />
      {user.area}
      <ChevronDown size={12} class="text-muted" />
    </button>
  </div>

  <!-- protection status -->
  <section class="relative mt-4 overflow-hidden rounded-[26px] bg-[#101216] p-5 text-white">
    <div
      class="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-safe/20 blur-3xl"
    ></div>
    <div class="pointer-events-none absolute -bottom-24 -left-10 h-44 w-44 rounded-full bg-[#2F6BFF]/15 blur-3xl"></div>

    <div class="relative flex items-start justify-between">
      <span class="grid h-11 w-11 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/10">
        <ShieldCheck size={22} strokeWidth={2.1} class="text-[#6EE7B7]" />
      </span>
      <span
        class="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-2.5 py-1 text-[10px] font-semibold text-[#8FF0C6] ring-1 ring-white/10"
      >
        <span class="h-1.5 w-1.5 rounded-full bg-[#34D399] animate-live"></span>
        Protected
      </span>
    </div>

    <div class="relative mt-4">
      <p class="text-[16px] font-semibold tracking-[-0.01em]">You're covered nearby</p>
      <p class="mt-1 text-[12px] leading-relaxed text-white/55">
        Live location is shared with trusted responders within 1&nbsp;km while protection is on.
      </p>
    </div>

    <div class="relative mt-4 flex items-center justify-between border-t border-white/10 pt-3.5">
      <div class="flex items-center gap-2">
        <div class="flex -space-x-2">
          {#each responders.slice(0, 3) as person}
            <span
              class="grid h-6 w-6 place-items-center rounded-full text-[8px] font-bold ring-2 ring-[#101216] {person.tone}"
              >{person.initials}</span
            >
          {/each}
        </div>
        <span class="text-[11px] font-medium text-white/60">+1 nearby</span>
      </div>
      <button
        type="button"
        onclick={() => onnavigate?.('contacts')}
        class="inline-flex items-center gap-1 text-[11px] font-semibold text-white/85 transition hover:text-white"
      >
        Manage
        <ChevronRight size={13} />
      </button>
    </div>
  </section>

  <!-- incoming alert -->
  {#if showIncoming}
    <section
      class="animate-rise mt-3.5 flex items-center gap-3 rounded-[20px] bg-[#FFF1F0] p-3 ring-1 ring-sos/10"
    >
      <span class="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sos/10">
        <span class="absolute h-full w-full rounded-full bg-sos/20 animate-sos-pulse"></span>
        <Siren size={16} class="relative text-sos" strokeWidth={2.3} />
      </span>
      <button type="button" onclick={onviewalert} class="min-w-0 flex-1 text-left">
        <p class="text-[12px] font-semibold leading-tight text-[#8f1d17]">SOS nearby · Sarah M.</p>
        <p class="mt-0.5 text-[11px] leading-tight text-[#b0544f]">Medical help · 400 m away · just now</p>
      </button>
      <button
        type="button"
        onclick={onviewalert}
        class="shrink-0 rounded-full bg-sos px-3 py-1.5 text-[10.5px] font-semibold text-white transition active:scale-95"
        >Respond</button
      >
      <button
        type="button"
        aria-label="Dismiss alert"
        onclick={ondismissincoming}
        class="shrink-0 text-[#c98b87] transition hover:text-[#8f1d17]"
      >
        <X size={14} />
      </button>
    </section>
  {/if}

  <!-- around you -->
  <section class="mt-5">
    <div class="flex items-end justify-between px-0.5">
      <div>
        <h2 class="text-[15px] font-semibold tracking-[-0.01em]">Around you</h2>
        <p class="mt-0.5 text-[11px] text-muted">Live safety map · updates every 15 s</p>
      </div>
      <button
        type="button"
        onclick={() => onnavigate?.('contacts')}
        class="text-[11px] font-semibold text-ink/60 transition hover:text-ink">View all</button
      >
    </div>

    <div class="mt-3">
      <MapCard onopen={() => onnavigate?.('contacts')} />
    </div>
  </section>

  <!-- quick actions -->
  <section class="mt-4 grid grid-cols-3 gap-2.5">
    {#each quickActions as action}
      {@const Icon = action.icon}
      <button
        type="button"
        onclick={() => runAction(action.id)}
        class="card flex flex-col items-start gap-2.5 rounded-[20px] p-3 text-left transition active:scale-[0.98]"
      >
        <span class="grid h-8 w-8 place-items-center rounded-xl {action.tone}">
          <Icon size={15} strokeWidth={2.2} />
        </span>
        <span class="leading-tight">
          <span class="block text-[11.5px] font-semibold text-ink">{action.label}</span>
          <span class="mt-0.5 block text-[10px] text-muted">{action.hint}</span>
        </span>
      </button>
    {/each}
  </section>

  <!-- responders -->
  <section class="mt-6">
    <div class="flex items-end justify-between px-0.5">
      <div>
        <h2 class="text-[15px] font-semibold tracking-[-0.01em]">Nearby responders</h2>
        <p class="mt-0.5 text-[11px] text-muted">Able to reach you in minutes</p>
      </div>
      <button
        type="button"
        onclick={() => onnavigate?.('contacts')}
        class="text-[11px] font-semibold text-ink/60 transition hover:text-ink">See all</button
      >
    </div>

    <div class="card mt-3 divide-y divide-line/80 overflow-hidden">
      {#each responders.slice(0, 3) as person}
        <button
          type="button"
          class="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[#FAFBFC]"
        >
          <span class="relative">
            <span class="grid h-10 w-10 place-items-center rounded-full text-[12px] font-bold {person.tone}"
              >{person.initials}</span
            >
            <span
              class="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-safe ring-2 ring-white"
            ></span>
          </span>
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-1">
              <span class="truncate text-[13px] font-semibold text-ink">{person.name}</span>
              {#if person.verified}
                <BadgeCheck size={13} class="shrink-0 text-[#2F6BFF]" strokeWidth={2.3} />
              {/if}
            </span>
            <span class="mt-0.5 block text-[11px] text-muted">{person.role} · {person.distance}</span>
          </span>
          <span
            class="grid h-8 w-8 place-items-center rounded-full bg-[#F5F6F8] text-ink/60 transition hover:bg-ink hover:text-white"
          >
            <ChevronRight size={15} />
          </span>
        </button>
      {/each}
    </div>
  </section>

  <!-- recent activity -->
  <section class="mt-6">
    <div class="flex items-end justify-between px-0.5">
      <h2 class="text-[15px] font-semibold tracking-[-0.01em]">Recent activity</h2>
      <button
        type="button"
        onclick={() => onnavigate?.('alerts')}
        class="text-[11px] font-semibold text-ink/60 transition hover:text-ink">History</button
      >
    </div>

    <div class="card mt-3 divide-y divide-line/80 overflow-hidden">
      {#each alertHistory.slice(0, 2) as item}
        <button
          type="button"
          onclick={() => onnavigate?.('alerts')}
          class="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-[#FAFBFC]"
        >
          <span
            class="grid h-9 w-9 place-items-center rounded-full {item.type === 'sent'
              ? 'bg-[#FFECEB] text-sos'
              : 'bg-[#E9F7F1] text-safe'}"
          >
            {#if item.type === 'sent'}
              <ArrowUpRight size={15} strokeWidth={2.4} />
            {:else}
              <Radio size={15} strokeWidth={2.2} />
            {/if}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[12.5px] font-semibold text-ink">{item.title}</span>
            <span class="mt-0.5 block text-[11px] text-muted">{item.date} · {item.time} · {item.place}</span>
          </span>
          <span
            class="rounded-full px-2 py-1 text-[9.5px] font-semibold {item.status === 'Cancelled'
              ? 'bg-[#F3F4F6] text-muted'
              : 'bg-[#E9F7F1] text-[#087a54]'}">{item.status}</span
          >
        </button>
      {/each}
    </div>
  </section>

  <p class="mt-6 text-center text-[10px] leading-relaxed text-muted/80">
    Alerts reach responders within a 1 km radius.<br />
    In immediate danger, call <span class="font-semibold text-ink/70">112</span>.
  </p>
</div>
