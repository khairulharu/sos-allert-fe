<script>
  import { Home, Bell, Users, UserRound } from '@lucide/svelte'
  import SosButton from './SosButton.svelte'

  let { active = 'home', onnavigate, onsos } = $props()

  const left = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'alerts', label: 'Alerts', icon: Bell },
  ]
  const right = [
    { id: 'contacts', label: 'Contacts', icon: Users },
    { id: 'profile', label: 'Profile', icon: UserRound },
  ]
</script>

<div class="pointer-events-none absolute inset-x-0 bottom-0 z-40">
  <div class="relative mx-4 mb-[max(16px,env(safe-area-inset-bottom))]">
    <!-- floating SOS -->
    <div class="pointer-events-auto absolute -top-8 left-1/2 z-10 -translate-x-1/2">
      <SosButton ontrigger={onsos} />
    </div>

    <nav
      aria-label="Main navigation"
      class="pointer-events-auto flex items-center justify-between rounded-[26px] bg-white/92 px-3 pb-2.5 pt-2 ring-1 ring-black/[0.05] backdrop-blur-xl"
      style="box-shadow: 0 18px 44px -18px rgba(16, 24, 40, 0.32)"
    >
      {#each left as item}
        {@const Icon = item.icon}
        <button
          type="button"
          onclick={() => onnavigate?.(item.id)}
          aria-current={active === item.id ? 'page' : undefined}
          class="flex w-[58px] flex-col items-center gap-1 rounded-2xl py-1.5 transition {active ===
          item.id
            ? 'text-ink'
            : 'text-muted hover:text-ink'}"
        >
          <span
            class="grid h-7 w-9 place-items-center rounded-full transition {active === item.id
              ? 'bg-ink text-white'
              : 'text-muted'}"
          >
            <Icon size={17} strokeWidth={active === item.id ? 2.4 : 2} />
          </span>
          <span class="text-[9.5px] font-semibold tracking-tight">{item.label}</span>
        </button>
      {/each}

      <!-- space for SOS -->
      <div class="w-[76px]" aria-hidden="true"></div>

      {#each right as item}
        {@const Icon = item.icon}
        <button
          type="button"
          onclick={() => onnavigate?.(item.id)}
          aria-current={active === item.id ? 'page' : undefined}
          class="flex w-[58px] flex-col items-center gap-1 rounded-2xl py-1.5 transition {active ===
          item.id
            ? 'text-ink'
            : 'text-muted hover:text-ink'}"
        >
          <span
            class="grid h-7 w-9 place-items-center rounded-full transition {active === item.id
              ? 'bg-ink text-white'
              : 'text-muted'}"
          >
            <Icon size={17} strokeWidth={active === item.id ? 2.4 : 2} />
          </span>
          <span class="text-[9.5px] font-semibold tracking-tight">{item.label}</span>
        </button>
      {/each}
    </nav>
  </div>
</div>
