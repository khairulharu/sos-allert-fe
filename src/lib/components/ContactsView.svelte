<script>
  import { onMount } from 'svelte'
  import { Search, Plus, Phone, MessageCircle, BadgeCheck, MapPin, ChevronRight, X, Loader } from '@lucide/svelte'
  import { contacts } from '$lib/api.js'

  let query = $state('')
  let loading = $state(true)
  let error = $state('')
  let contacts_list = $state([])
  let adding = $state(false)
  let saving = $state(false)
  let addError = $state('')
  let form = $state({ contact_name: '', phone_number: '', relationship: '' })

  const list = $derived(
    contacts_list.filter((person) => person.contact_name?.toLowerCase().includes(query.toLowerCase().trim())),
  )

  onMount(async () => {
    try {
      const data = await contacts.list()
      contacts_list = Array.isArray(data) ? data : data?.data || []
    } catch (e) {
      error = e?.message || 'Failed to load contacts'
    } finally {
      loading = false
    }
  })

  function initialsFor(name) {
    return (name || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('')
  }

  function toneFor(index) {
    const tones = [
      'bg-[#F3B3C6] text-[#831843]',
      'bg-[#9DB8F5] text-[#1e3a8a]',
      'bg-[#A7DCC7] text-[#065f46]',
      'bg-[#F2C879] text-[#6b4a10]',
    ]
    return tones[index % tones.length]
  }

  function toggleAdd() {
    adding = !adding
    addError = ''
    if (!adding) form = { contact_name: '', phone_number: '', relationship: '' }
  }

  async function createContact() {
    if (!form.contact_name?.trim() || !form.phone_number?.trim()) {
      addError = 'Name and phone are required.'
      return
    }
    saving = true
    addError = ''
    try {
      await contacts.create({
        contact_name: form.contact_name.trim(),
        phone_number: form.phone_number.trim(),
        relationship: form.relationship?.trim() || '',
      })
      form = { contact_name: '', phone_number: '', relationship: '' }
      adding = false
      const data = await contacts.list()
      contacts_list = Array.isArray(data) ? data : data?.data || []
    } catch (e) {
      addError = e?.message || 'Could not save contact.'
    } finally {
      saving = false
    }
  }

  function callNumber(person) {
    if (person.phone_number) window.location.href = `tel:${person.phone_number}`
  }
</script>

<div class="px-5 pb-4 pt-7">
  <header class="flex items-start justify-between">
    <div>
      <p class="text-[12px] font-medium text-muted">Your safety circle</p>
      <h1 class="mt-1 text-[26px] font-semibold tracking-[-0.035em]">Contacts</h1>
    </div>
    <button
      type="button"
      onclick={toggleAdd}
      class="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-[11px] font-semibold text-white transition active:scale-95"
    >
      {#if adding}
        <X size={14} strokeWidth={2.6} />
        Close
      {:else}
        <Plus size={14} strokeWidth={2.6} />
        Add
      {/if}
    </button>
  </header>

  <!-- add form -->
  {#if adding}
    <div class="card mt-4 space-y-2.5 p-4">
      <div>
        <label for="contact-name" class="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Name</label>
        <input
          id="contact-name"
          type="text"
          bind:value={form.contact_name}
          placeholder="e.g. Dewi Anwar"
          class="w-full rounded-xl bg-[#F5F6F8] px-3 py-2.5 text-[12.5px] font-medium text-ink outline-none ring-1 ring-black/5 placeholder:text-muted/70 focus:ring-2 focus:ring-ink/15"
        />
      </div>
      <div>
        <label for="contact-phone" class="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Phone</label>
        <input
          id="contact-phone"
          type="tel"
          bind:value={form.phone_number}
          placeholder="+62 812 3456 7890"
          class="w-full rounded-xl bg-[#F5F6F8] px-3 py-2.5 text-[12.5px] font-medium text-ink outline-none ring-1 ring-black/5 placeholder:text-muted/70 focus:ring-2 focus:ring-ink/15"
        />
      </div>
      <div>
        <label for="contact-relationship" class="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Relationship</label>
        <input
          id="contact-relationship"
          type="text"
          bind:value={form.relationship}
          placeholder="e.g. Mother"
          class="w-full rounded-xl bg-[#F5F6F8] px-3 py-2.5 text-[12.5px] font-medium text-ink outline-none ring-1 ring-black/5 placeholder:text-muted/70 focus:ring-2 focus:ring-ink/15"
        />
      </div>
      {#if addError}
        <p class="text-[11px] font-medium text-sos">{addError}</p>
      {/if}
      <button
        type="button"
        onclick={createContact}
        disabled={saving}
        class="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-ink py-2.5 text-[12px] font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
      >
        {#if saving}
          <Loader size={14} class="animate-spin" />
          Saving…
        {:else}
          <Plus size={14} />
          Save contact
        {/if}
      </button>
    </div>
  {/if}

  <!-- search -->
  <div class="relative mt-5">
    <Search size={16} class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
    <input
      type="search"
      bind:value={query}
      placeholder="Search contacts"
      aria-label="Search contacts"
      class="w-full rounded-full bg-white py-2.5 pl-10 pr-4 text-[12.5px] font-medium text-ink outline-none ring-1 ring-black/5 placeholder:text-muted/80 focus:ring-2 focus:ring-ink/15"
    />
  </div>

  <!-- list -->
  <section class="mt-5">
    <div class="flex items-center justify-between px-0.5">
      <h2 class="eyebrow text-ink/50">Trusted people</h2>
      <span class="text-[10px] font-medium text-muted">{list.length} people</span>
    </div>

    <div class="card mt-2.5 divide-y divide-line/80 overflow-hidden">
      {#if loading}
        <div class="flex items-center justify-center gap-2.5 px-4 py-10 text-[12.5px] font-medium text-muted">
          <Loader size={15} class="animate-spin" />
          Loading contacts…
        </div>
      {:else if error}
        <div class="px-4 py-10 text-center">
          <p class="text-[12.5px] font-semibold text-ink">Couldn't load contacts</p>
          <p class="mt-1 text-[11px] text-muted">{error}</p>
        </div>
      {:else if list.length === 0}
        <div class="px-4 py-10 text-center">
          <p class="text-[12.5px] font-semibold text-ink">No contacts yet</p>
          <p class="mt-1 text-[11px] text-muted">Add your first emergency contact.</p>
        </div>
      {:else}
        {#each list as person, i}
          <div class="flex items-center gap-3 px-4 py-3.5">
            <span class="relative shrink-0">
              <span class="grid h-10 w-10 place-items-center rounded-full text-[12px] font-bold {toneFor(i)}"
                >{initialsFor(person.contact_name)}</span
              >
            </span>

            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1">
                <p class="truncate text-[13px] font-semibold text-ink">{person.contact_name}</p>
                {#if person.is_verified}
                  <BadgeCheck size={13} class="shrink-0 text-[#2F6BFF]" strokeWidth={2.3} />
                {/if}
              </div>
              <p class="mt-0.5 truncate text-[10.5px] text-muted">
                {person.relationship || '—'} · {person.phone_number || '—'}
              </p>
            </div>

            <div class="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                aria-label="Message {person.contact_name}"
                class="grid h-8 w-8 place-items-center rounded-full bg-[#F5F6F8] text-ink/60 transition hover:bg-ink hover:text-white active:scale-95"
              >
                <MessageCircle size={14} />
              </button>
              <button
                type="button"
                aria-label="Call {person.contact_name}"
                onclick={() => callNumber(person)}
                class="grid h-8 w-8 place-items-center rounded-full bg-[#E9F7F1] text-safe transition hover:bg-safe hover:text-white active:scale-95"
              >
                <Phone size={13.5} />
              </button>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </section>

  <button
    type="button"
    onclick={toggleAdd}
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
