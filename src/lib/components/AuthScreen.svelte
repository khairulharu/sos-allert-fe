<script>
  import { onDestroy } from 'svelte'
  import { Siren, MapPin, ShieldCheck, Loader2, Eye, EyeOff } from '@lucide/svelte'
  import { login, register } from '$lib/stores.js'
  import { retrySeconds, formatCooldown } from '$lib/rateLimit.js'

  let { onsuccess, notice = '' } = $props()

  // Auth lockout is 15 minutes; used only when the browser cannot read
  // Retry-After (cross-origin CORS currently exposes just Content-Disposition).
  const AUTH_FALLBACK_LOCKOUT = 15 * 60

  let mode = $state('login') // 'login' | 'signup'
  let id = $state('')
  let password = $state('')
  let name = $state('')
  let showPass = $state(false)
  let error = $state('')
  let errorField = $state('')
  let busy = $state(false)
  let hint = $state('')
  let cooldown = $state(0)
  let cooldownTimer = null

  function startCooldown(seconds) {
    clearInterval(cooldownTimer)
    cooldown = Math.max(1, Math.ceil(seconds))
    cooldownTimer = setInterval(() => {
      cooldown -= 1
      if (cooldown <= 0) {
        cooldown = 0
        clearInterval(cooldownTimer)
        cooldownTimer = null
        if (error.startsWith('Too many attempts')) error = ''
      }
    }, 1000)
  }

  onDestroy(() => clearInterval(cooldownTimer))

  function suggestId() {
    if (id) return
    const base = (name || 'user').toLowerCase().replace(/[^a-z0-9]/g, '_')
    id = base + '_' + Math.random().toString(36).slice(2, 7)
  }

  async function submit() {
    // A form submit can arrive twice (double tap, Enter plus click). The backend
    // rotates the account token on every login, so a second request would leave
    // this client holding a token the server no longer accepts.
    if (busy) return
    error = ''
    errorField = ''
    hint = ''
    if (cooldown > 0) {
      error = `Too many attempts. Try again in ${formatCooldown(cooldown)}.`
      return
    }
    if (!id.trim() || password.length < 4) {
      errorField = !id.trim() ? 'id' : 'password'
      error = 'Enter a user ID and a password of at least 4 characters.'
      return
    }
    if (mode === 'signup' && !name.trim()) {
      errorField = 'name'
      error = 'Enter your display name.'
      return
    }
    busy = true
    try {
      if (mode === 'signup') {
        await register(id.trim(), password, name.trim())
        hint = 'Account created — you are signed in.'
      } else {
        await login(id.trim(), password)
      }
      onsuccess?.()
    } catch (err) {
      if (err?.status === 429) {
        const wait = retrySeconds(err) ?? AUTH_FALLBACK_LOCKOUT
        startCooldown(wait)
        error = `Too many attempts. Try again in ${formatCooldown(wait)}.`
      } else {
        error = err?.message || 'Something went wrong. Check the backend is running.'
      }
    } finally {
      busy = false
    }
  }
</script>

<div class="relative flex min-h-dvh w-full items-center justify-center overflow-hidden bg-[#E7E9ED]">
  <div class="pointer-events-none absolute inset-0">
    <div class="absolute -left-24 top-10 h-80 w-80 rounded-full bg-[#FF3B30]/10 blur-3xl"></div>
    <div class="absolute -right-20 bottom-0 h-96 w-96 rounded-full bg-[#2F6BFF]/10 blur-3xl"></div>
  </div>

  <div class="relative z-10 w-full max-w-[430px] px-6 py-10">
    <div class="flex flex-col items-center text-center">
      <span class="relative grid h-16 w-16 place-items-center rounded-[22px] bg-ink">
        <span class="absolute inset-0 rounded-[22px] bg-gradient-to-br from-white/20 to-transparent"></span>
        <Siren size={30} class="relative text-white" strokeWidth={2.2} />
      </span>
      <h1 class="mt-4 text-[26px] font-semibold tracking-[-0.03em]">
        sos<span class="text-sos">.</span>alert
      </h1>
      <p class="mt-1.5 max-w-[280px] text-[13.5px] leading-relaxed text-muted">
        Community safety. One hold on the SOS button gets AI-prioritized help to your location.
      </p>
    </div>

    <!-- card -->
    <div class="card mt-7 rounded-[28px] p-5">
      <div class="flex rounded-full bg-[#ECEEF1] p-1">
        <button
          type="button"
          onclick={() => (mode = 'login')}
          aria-pressed={mode === 'login'}
          class="flex min-h-[44px] flex-1 items-center justify-center rounded-full py-2 text-[13px] font-semibold transition {mode === 'login'
            ? 'bg-white text-ink shadow-sm'
            : 'text-muted hover:text-ink'}"
        >Sign in</button>
        <button
          type="button"
          onclick={() => (mode = 'signup')}
          aria-pressed={mode === 'signup'}
          class="flex min-h-[44px] flex-1 items-center justify-center rounded-full py-2 text-[13px] font-semibold transition {mode === 'signup'
            ? 'bg-white text-ink shadow-sm'
            : 'text-muted hover:text-ink'}"
        >Create account</button>
      </div>

      <form class="mt-5 space-y-3" onsubmit={(e) => { e.preventDefault(); submit() }}>
        {#if mode === 'signup'}
          <label class="block">
            <span class="mb-1 block text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">Display name</span>
            <input
              bind:value={name}
              oninput={suggestId}
              type="text"
              placeholder="e.g. Khairul"
              autocomplete="name"
              aria-invalid={errorField === 'name' ? 'true' : undefined}
              aria-describedby={errorField === 'name' ? 'auth-error' : undefined}
              class="w-full rounded-2xl bg-[#F5F6F8] px-4 py-3 text-[16px] leading-tight font-medium text-ink outline-none ring-1 ring-black/[0.04] placeholder:text-muted/70 focus:ring-2 focus:ring-ink/15"
            />
          </label>
        {/if}

        <label class="block">
          <span class="mb-1 block text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">User ID</span>
          <input
            bind:value={id}
            type="text"
            placeholder="e.g. khairul_bali"
            autocomplete="username"
            aria-invalid={errorField === 'id' ? 'true' : undefined}
            aria-describedby={errorField === 'id' ? 'auth-error' : undefined}
            class="w-full rounded-2xl bg-[#F5F6F8] px-4 py-3 text-[16px] leading-tight font-medium text-ink outline-none ring-1 ring-black/[0.04] placeholder:text-muted/70 focus:ring-2 focus:ring-ink/15"
          />
        </label>

        <label class="block">
          <span class="mb-1 block text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">Password</span>
          <div class="relative">
            <input
              bind:value={password}
              type={showPass ? 'text' : 'password'}
              placeholder="••••••••"
              autocomplete={mode === 'signup' ? 'new-password' : 'current-password'}
              aria-invalid={errorField === 'password' ? 'true' : undefined}
              aria-describedby={errorField === 'password' ? 'auth-error' : undefined}
              class="w-full rounded-2xl bg-[#F5F6F8] px-4 py-3 pr-11 text-[16px] leading-tight font-medium text-ink outline-none ring-1 ring-black/[0.04] placeholder:text-muted/70 focus:ring-2 focus:ring-ink/15"
            />
            <button
              type="button"
              aria-label={showPass ? 'Hide password' : 'Show password'}
              onclick={() => (showPass = !showPass)}
              class="absolute right-3 top-1/2 -mr-2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full text-muted transition hover:text-ink"
            >{#if showPass}<EyeOff size={16} />{:else}<Eye size={16} />{/if}</button>
          </div>
        </label>

        {#if notice}
          <p class="rounded-2xl bg-[#FFF6E5] px-3.5 py-2.5 text-[13px] font-medium text-[#8a5a00]">
            {notice}
          </p>
        {/if}
        {#if error}
          <p
            id="auth-error"
            role="alert"
            class="rounded-2xl bg-[#FFECEB] px-3.5 py-2.5 text-[13px] font-medium text-[#b3241d]"
          >
            {error}
            {#if cooldown > 0}
              <span class="mt-1 block text-[12px] font-normal text-[#b3241d]/80">
                Sign in and registration share the same limit.
              </span>
            {/if}
          </p>
        {/if}
        {#if hint}
          <p class="rounded-2xl bg-[#E9F7F1] px-3.5 py-2.5 text-[13px] font-medium text-[#087a54]">
            {hint}
          </p>
        {/if}

        <button
          type="submit"
          disabled={busy || cooldown > 0}
          class="flex w-full items-center justify-center gap-2 rounded-full bg-ink py-3.5 text-[14px] font-semibold text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {#if busy}<Loader2 size={15} class="animate-spin" />{/if}
          {#if cooldown > 0}
            Try again in {formatCooldown(cooldown)}
          {:else}
            {mode === 'login' ? 'Sign in' : 'Create account'}
          {/if}
        </button>
      </form>
    </div>

    <!-- reassurance -->
    <div
      class="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[12px] font-medium text-muted"
    >
      <span class="inline-flex items-center gap-1 text-center"
        ><MapPin size={11} class="shrink-0 text-sos" /> Location only during SOS</span
      >
      <span class="inline-flex items-center gap-1 text-center"
        ><ShieldCheck size={11} class="shrink-0 text-safe" /> Nearby responders who share their
        location</span
      >
    </div>
  </div>
</div>
