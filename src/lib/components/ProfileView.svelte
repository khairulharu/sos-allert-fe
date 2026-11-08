<script>
  import {
    MapPin,
    ShieldCheck,
    BellRing,
    Navigation,
    HeartPulse,
    LogOut,
    Users,
  } from '@lucide/svelte'
  import { onMount } from 'svelte'
  import { locationSharing, place } from '$lib/stores.js'
  import { responders } from '$lib/geo.js'
  import { contacts } from '$lib/api.js'
  import { enablePush, disablePush, pushPermissionState } from '$lib/push.js'

  // `user` is the session profile from /api/users/_current. Nothing here may be
  // invented: an unknown field renders as absent, never as a plausible number.
  let { user = {}, onsignout } = $props()

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
  const memberSince = $derived(
    user?.created_at
      ? new Date(user.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      : '',
  )

  // Real counts only. The account API has no alert total, so profile shows the
  // two figures the app can actually observe: saved contacts and live nearby
  // responders.
  let contactsCount = $state(null)
  let pushOn = $state(false)
  let pushHint = $state('')

  onMount(async () => {
    pushOn = pushPermissionState() === 'granted'
    try {
      const list = await contacts.list()
      contactsCount = Array.isArray(list) ? list.length : null
    } catch {
      /* a failed count stays unshown rather than becoming a made-up one */
    }
  })

  async function toggleLocation() {
    locationSharing.update((on) => !on)
  }

  async function togglePush() {
    if (pushOn) {
      pushOn = false
      pushHint = ''
      await disablePush()
      return
    }
    const res = await enablePush()
    pushOn = !!res.ok
    pushHint = res.ok ? '' : res.message
  }

  const toggles = [
    {
      key: 'location',
      title: 'Live location',
      hint: 'Shared with responders while you are online',
      icon: Navigation,
      tone: 'bg-[#EAF0FF] text-[#2F5BD0]',
    },
    {
      key: 'push',
      title: 'Push notifications',
      hint: 'Nearby SOS alerts and updates',
      icon: BellRing,
      tone: 'bg-[#FFF6E5] text-[#8a5c05]',
    },
  ]
</script>

<div class="px-5 pb-4 pt-7">
  <header>
    <p class="text-[13px] font-medium text-muted">Account &amp; safety</p>
    <h1 class="mt-1 text-[26px] font-semibold tracking-[-0.035em]">Profile</h1>
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
      </div>

      <div class="mt-2.5">
        <h2 class="text-[17px] font-semibold tracking-[-0.02em]">{fullName}</h2>
        <p class="mt-0.5 text-[13px] text-muted">{user?.phone || user?.id || '—'}</p>
        <p class="mt-2 inline-flex flex-wrap items-center gap-1 text-[12px] font-medium text-muted">
          <MapPin size={12} class="text-sos" />
          <span>{$place || 'Location unavailable'}</span>
          {#if memberSince}
            <span aria-hidden="true">·</span>
            <span>Member since {memberSince}</span>
          {/if}
        </p>
      </div>

      <div class="mt-4 grid grid-cols-2 divide-x divide-line rounded-2xl bg-[#F8F9FA] py-3 ring-1 ring-black/[0.03]">
        <div class="text-center">
          <p class="text-[16px] font-semibold tracking-tight">{contactsCount ?? '—'}</p>
          <p class="mt-0.5 text-[12px] font-medium text-muted">Emergency contacts</p>
        </div>
        <div class="text-center">
          <p class="text-[16px] font-semibold tracking-tight">{$responders.length}</p>
          <p class="mt-0.5 text-[12px] font-medium text-muted">Responders nearby</p>
        </div>
      </div>
    </div>
  </section>

  <!-- protection -->
  <section class="mt-6">
    <div class="flex items-center gap-1.5 px-0.5">
      <ShieldCheck size={14} class="text-safe" />
      <h2 class="eyebrow text-ink/60">Protection</h2>
    </div>

    <div class="card mt-2.5 divide-y divide-line/80 overflow-hidden">
      {#each toggles as item}
        {@const Icon = item.icon}
        {@const checked = item.key === 'location' ? $locationSharing : pushOn}
        <div class="flex items-center gap-3 px-4 py-3.5">
          <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl {item.tone}">
            <Icon size={16} strokeWidth={2.2} />
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-[13.5px] font-semibold text-ink">{item.title}</p>
            <p class="mt-0.5 truncate text-[12px] text-muted">
              {item.key === 'push' && pushHint ? pushHint : item.hint}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={item.title}
            onclick={() => (item.key === 'location' ? toggleLocation() : togglePush())}
            class="relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200 {checked
              ? 'bg-safe'
              : 'bg-[#E3E6EA]'}"
          >
            <span
              class="absolute top-[3px] left-0 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 {checked
                ? 'translate-x-[21px]'
                : 'translate-x-[3px]'}"
            ></span>
          </button>
        </div>
      {/each}
    </div>
  </section>

  <!-- emergency information: read-only until the profile API has an editor -->
  <section class="mt-6">
    <h2 class="eyebrow px-0.5 text-ink/60">Emergency information</h2>
    <div class="card mt-2.5 flex items-start gap-3 px-4 py-3.5">
      <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#FFECEB] text-sos">
        <HeartPulse size={16} strokeWidth={2.2} />
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-[13.5px] font-semibold text-ink">No medical information saved</p>
        <p class="mt-0.5 text-[12px] text-muted">Responders only see this during an active SOS.</p>
      </div>
    </div>
  </section>

  <button
    type="button"
    onclick={onsignout}
    class="mt-6 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full bg-white py-3 text-[13px] font-semibold text-sos ring-1 ring-black/5 transition hover:bg-[#FFF5F4] active:scale-[0.99]"
  >
    <LogOut size={15} />
    Sign out
  </button>

  <div class="mt-5 flex items-center justify-center gap-2 text-[12px] font-medium text-muted">
    <span>sos.alert v1.0.0</span>
    {#if $responders.length}
      <span aria-hidden="true" class="h-2.5 w-px bg-line"></span>
      <span class="inline-flex items-center gap-1"><Users size={11} /> {$responders.length} nearby</span>
    {/if}
  </div>
</div>
