<script>
  import {
    Settings,
    BadgeCheck,
    Pencil,
    MapPin,
    ShieldCheck,
    Siren,
    BellRing,
    Navigation,
    HeartPulse,
    ChevronRight,
    Lock,
    LifeBuoy,
    LogOut,
    PhoneCall,
    Users,
  } from '@lucide/svelte'
  import { user as mockUser } from '$lib/data.js'
  import { place } from '$lib/stores.js'

  let { user = mockUser, onsignout } = $props()

  const name = $derived(user?.name || '')
  const fullName = $derived(user?.fullName || name || '—')
  const initials = $derived(
    user?.initials ||
      (name
        ? name
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w[0]?.toUpperCase())
            .join('')
        : '—'),
  )
  const trustScore = $derived(user?.trustScore ?? 100)
  const memberSince = $derived(
    user?.memberSince || (user?.created_at ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '—'),
  )

  let settings = $state({
    location: true,
    push: true,
    siren: false,
    autocall: true,
  })

  const toggles = [
    {
      key: 'location',
      title: 'Live location',
      hint: 'Shared with responders while active',
      icon: Navigation,
      tone: 'bg-[#EAF0FF] text-[#2F6BFF]',
    },
    {
      key: 'push',
      title: 'Push notifications',
      hint: 'Nearby SOS alerts and updates',
      icon: BellRing,
      tone: 'bg-[#FFF6E5] text-[#9a6b12]',
    },
    {
      key: 'siren',
      title: 'Siren sound',
      hint: 'Play a loud siren during SOS',
      icon: Siren,
      tone: 'bg-[#FFECEB] text-sos',
    },
    {
      key: 'autocall',
      title: 'Auto-call 112',
      hint: 'Dial emergency if unacknowledged',
      icon: PhoneCall,
      tone: 'bg-[#E9F7F1] text-safe',
    },
  ]

  const links = [
    { title: 'Emergency medical info', hint: 'Blood type, allergies, conditions', icon: HeartPulse },
    { title: 'Privacy & data', hint: 'Location history and permissions', icon: Lock },
    { title: 'Help & support', hint: 'Guides, contact us, report a bug', icon: LifeBuoy },
  ]
</script>

<div class="px-5 pb-4 pt-7">
  <header class="flex items-start justify-between">
    <div>
      <p class="text-[12px] font-medium text-muted">Account & safety</p>
      <h1 class="mt-1 text-[26px] font-semibold tracking-[-0.035em]">Profile</h1>
    </div>
    <button
      type="button"
      aria-label="Settings"
      class="grid h-9 w-9 place-items-center rounded-full bg-white text-ink/60 ring-1 ring-black/5 transition hover:text-ink active:scale-95"
    >
      <Settings size={16} />
    </button>
  </header>

  <!-- identity -->
  <section class="card mt-5 overflow-hidden">
    <div class="relative h-[74px] bg-[#101216]">
      <div class="absolute inset-0 bg-[radial-gradient(120%_140%_at_15%_0%,rgba(255,59,48,0.35),transparent_55%)]"></div>
      <div class="absolute inset-0 bg-[radial-gradient(90%_120%_at_90%_20%,rgba(47,107,255,0.28),transparent_60%)]"></div>
    </div>
    <div class="px-4 pb-4">
      <div class="relative z-10 -mt-7 flex items-end justify-between">
        <span
          class="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-[#5B8CFF] to-[#2F55D4] text-[16px] font-bold text-white ring-4 ring-white shadow-md"
          >{initials}</span
        >
        <button
          type="button"
          class="mb-1 inline-flex items-center gap-1.5 rounded-full bg-[#F5F6F8] px-3 py-1.5 text-[10.5px] font-semibold text-ink/70 transition hover:bg-ink hover:text-white"
        >
          <Pencil size={11} />
          Edit
        </button>
      </div>

      <div class="mt-2.5">
        <div class="flex items-center gap-1.5">
          <h2 class="text-[17px] font-semibold tracking-[-0.02em]">{fullName}</h2>
          <BadgeCheck size={15} class="text-[#2F6BFF]" strokeWidth={2.4} />
        </div>
        <p class="mt-0.5 text-[11.5px] text-muted">{user?.phone || user?.id || '—'}</p>
        <p class="mt-2 inline-flex items-center gap-1 text-[10.5px] font-medium text-muted">
          <MapPin size={11} class="text-sos" />
          {$place || 'Location unavailable'} · Member since {memberSince}
        </p>
      </div>

      <div class="mt-4 grid grid-cols-3 divide-x divide-line rounded-2xl bg-[#F8F9FA] py-3 ring-1 ring-black/[0.03]">
        <div class="text-center">
          <p class="text-[16px] font-semibold tracking-tight">12</p>
          <p class="mt-0.5 text-[9.5px] font-medium text-muted">Alerts sent</p>
        </div>
        <div class="text-center">
          <p class="text-[16px] font-semibold tracking-tight">4</p>
          <p class="mt-0.5 text-[9.5px] font-medium text-muted">Contacts</p>
        </div>
        <div class="text-center">
          <p class="text-[16px] font-semibold tracking-tight text-safe">{trustScore}</p>
          <p class="mt-0.5 text-[9.5px] font-medium text-muted">Trust score</p>
        </div>
      </div>
    </div>
  </section>

  <!-- protection -->
  <section class="mt-6">
    <div class="flex items-center gap-1.5 px-0.5">
      <ShieldCheck size={13} class="text-safe" />
      <h2 class="eyebrow text-ink/50">Protection</h2>
    </div>

    <div class="card mt-2.5 divide-y divide-line/80 overflow-hidden">
      {#each toggles as item}
        {@const Icon = item.icon}
        <div class="flex items-center gap-3 px-4 py-3.5">
          <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl {item.tone}">
            <Icon size={15} strokeWidth={2.2} />
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-[12.5px] font-semibold text-ink">{item.title}</p>
            <p class="mt-0.5 truncate text-[10.5px] text-muted">{item.hint}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings[item.key]}
            aria-label={item.title}
            onclick={() => (settings[item.key] = !settings[item.key])}
            class="relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200 {settings[
              item.key
            ]
              ? 'bg-safe'
              : 'bg-[#E3E6EA]'}"
          >
            <span
              class="absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 {settings[
                item.key
              ]
                ? 'translate-x-[21px]'
                : 'translate-x-[3px]'}"
            ></span>
          </button>
        </div>
      {/each}
    </div>
  </section>

  <!-- emergency info -->
  <section class="mt-6">
    <h2 class="eyebrow px-0.5 text-ink/50">Emergency information</h2>
    <div class="card mt-2.5 flex items-center gap-3 px-4 py-3.5">
      <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#FFECEB] text-sos">
        <HeartPulse size={15} strokeWidth={2.2} />
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-[12.5px] font-semibold text-ink">Blood type O+ · Penicillin allergy</p>
        <p class="mt-0.5 text-[10.5px] text-muted">Shared only when an SOS is active</p>
      </div>
      <ChevronRight size={16} class="shrink-0 text-muted" />
    </div>
  </section>

  <!-- links -->
  <section class="card mt-4 divide-y divide-line/80 overflow-hidden">
    {#each links as item}
      {@const Icon = item.icon}
      <button
        type="button"
        class="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-[#FAFBFC]"
      >
        <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#F5F6F8] text-ink/60">
          <Icon size={14} strokeWidth={2.1} />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-[12.5px] font-semibold text-ink">{item.title}</span>
          <span class="mt-0.5 block truncate text-[10.5px] text-muted">{item.hint}</span>
        </span>
        <ChevronRight size={15} class="shrink-0 text-muted" />
      </button>
    {/each}
  </section>

  <button
    type="button"
    onclick={onsignout}
    class="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-white py-3 text-[12px] font-semibold text-sos ring-1 ring-black/5 transition hover:bg-[#FFF5F4] active:scale-[0.99]"
  >
    <LogOut size={14} />
    Sign out
  </button>

  <div class="mt-5 flex items-center justify-center gap-3 text-[9.5px] font-medium text-muted">
    <span>sos.alert v1.0.0</span>
    <span class="h-2.5 w-px bg-line"></span>
    <span class="inline-flex items-center gap-1"><Users size={10} /> 1,248 responders nearby</span>
  </div>
</div>
