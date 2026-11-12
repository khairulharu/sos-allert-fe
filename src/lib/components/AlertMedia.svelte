<script>
  import { onDestroy } from 'svelte'
  import { Loader2, Mic, Video } from '@lucide/svelte'
  import { sos as sosApi } from '$lib/api.js'
  import { timeAgo } from '$lib/alertMeta.js'

  // Evidence a responder can actually listen to.
  //
  // Two backend facts shape this component: the stream endpoint needs the raw
  // Authorization header (so `<audio src>` cannot point at it — we fetch a Blob
  // and play an object URL), and there is no `MEDIA_ADDED` frame and no media on
  // `AlertDetailResponse` (so the list is polled while the sheet is open).
  // Only a recorded responder may read media; `enabled` comes from the sheet's
  // `responded` state, everyone else would get a 403.
  let { alertId = '', enabled = false, pollMs = 12000 } = $props()

  let items = $state([])
  let listState = $state('idle') // idle | loading | ready | error | forbidden
  let listError = $state('')
  let blobs = $state({}) // media id → { url, video } | { error }
  // Object URLs are bookkeeping, not view state: they are revoked on teardown
  // and reading a Map in the template would never be reactive anyway.
  const objectUrls = new Map()
  // Bumped whenever the alert changes or the sheet closes, so a slow list or
  // blob response for the previous alert is dropped instead of painted.
  let generation = 0

  const TRANSCRIPTION_NOTES = {
    disabled: 'Speech transcription is off on the server, so there is no text.',
    too_large: 'The recording was too large to transcribe.',
    empty: 'No speech was recognized in this recording.',
    failed: 'The recording could not be transcribed, but it plays normally.',
  }

  function revokeAll() {
    for (const url of objectUrls.values()) URL.revokeObjectURL(url)
    objectUrls.clear()
  }

  function isVideo(media) {
    const type = String(media?.content_type || '').toLowerCase()
    if (type) return type.startsWith('video/')
    return /\.(mp4|webm|mov|m4v)$/i.test(media?.filename || '')
  }

  function fileSize(bytes) {
    const value = Number(bytes)
    if (!Number.isFinite(value) || value <= 0) return ''
    return value >= 1024 * 1024
      ? `${(value / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.max(1, Math.round(value / 1024))} KB`
  }

  function recordingMeta(media) {
    return [fileSize(media?.size_bytes), media?.uploaded_at ? timeAgo(media.uploaded_at) : '']
      .filter(Boolean)
      .join(' · ')
  }

  // One fetch per media row. The blob stays alive for the life of the sheet, so
  // replaying the clip never re-hits the backend; a transient failure is retried
  // on the next poll, a permanent one (missing file, no storage) is not.
  function ensureBlob(id, media, mine) {
    if (!media?.id) return
    const known = blobs[media.id]
    if (known && (known.loading || known.url || known.permanent)) return

    blobs[media.id] = { loading: true }
    sosApi
      .mediaBlob(id, media.id)
      .then((blob) => {
        if (mine !== generation) return
        const url = URL.createObjectURL(blob)
        objectUrls.set(media.id, url)
        blobs[media.id] = { url, video: isVideo(media) }
      })
      .catch((err) => {
        if (mine !== generation) return
        blobs[media.id] = {
          permanent: err?.status === 404 || err?.status === 412,
          error:
            err?.status === 412
              ? 'The server has no media storage configured.'
              : err?.status === 404
                ? 'This recording is no longer available.'
                : 'Could not load this recording.',
        }
      })
  }

  async function loadList(id, mine) {
    try {
      const data = await sosApi.listMedia(id)
      if (mine !== generation) return
      items = Array.isArray(data) ? data : []
      listState = 'ready'
      listError = ''
      for (const media of items) ensureBlob(id, media, mine)
    } catch (err) {
      if (mine !== generation) return
      // 403 means "not a recorded responder yet": the sheet is still showing the
      // respond action, so there is nothing to report here.
      if (err?.status === 403) {
        items = []
        listState = 'forbidden'
        return
      }
      listState = 'error'
      listError =
        err?.status === 412
          ? 'Media storage is not configured on the server.'
          : err?.message || 'Could not load the recordings for this alert.'
    }
  }

  $effect(() => {
    const id = alertId
    if (!enabled || !id) return

    generation += 1
    const mine = generation
    items = []
    listState = 'loading'
    listError = ''
    blobs = {}
    revokeAll()

    loadList(id, mine)
    // Poll: the upload lands a few seconds after the trigger and the tracking
    // socket never announces it.
    const timer = setInterval(() => {
      if (!document.hidden) loadList(id, mine)
    }, pollMs)
    // A backgrounded tab throttles timers; catching up on return keeps the
    // evidence from sitting stale for up to a poll interval.
    const onVisible = () => {
      if (!document.hidden) loadList(id, mine)
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      generation += 1
      revokeAll()
    }
  })

  onDestroy(() => {
    generation += 1
    revokeAll()
  })
</script>

{#if items.length > 0}
  <div>
    <div class="flex items-baseline justify-between px-0.5">
      <p class="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        Evidence · {items.length} {items.length === 1 ? 'clip' : 'clips'}
      </p>
      {#if listState === 'loading'}
        <span class="inline-flex items-center gap-1 text-[11px] text-muted">
          <Loader2 size={10} class="animate-spin" />
          Checking
        </span>
      {/if}
    </div>

    <div class="card mt-2 divide-y divide-line/80 overflow-hidden">
      {#each items as media (media.id)}
        {@const blob = blobs[media.id]}
        {@const video = isVideo(media)}
        <div class="px-3.5 py-3">
          <div class="flex items-center gap-2.5">
            <span
              class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#FFECEB] text-sos"
            >
              {#if video}
                <Video size={16} strokeWidth={2.2} />
              {:else}
                <Mic size={16} strokeWidth={2.2} />
              {/if}
            </span>
            <div class="min-w-0 flex-1">
              <p class="text-[13px] font-semibold text-ink">
                {video ? 'Video evidence' : 'Audio evidence'}
              </p>
              {#if recordingMeta(media)}
                <p class="mt-0.5 text-[12px] text-muted">{recordingMeta(media)}</p>
              {/if}
            </div>
          </div>

          {#if blob?.url}
            {#if blob.video}
              <!-- svelte-ignore a11y_media_has_caption -->
              <video
                class="mt-2.5 w-full rounded-xl bg-black"
                src={blob.url}
                controls
                playsinline
                preload="metadata"
                aria-label="Video recorded by the sender"
              ></video>
            {:else}
              <audio
                class="mt-2.5 w-full"
                src={blob.url}
                controls
                preload="metadata"
                aria-label="Audio recorded by the sender"
              ></audio>
            {/if}
          {:else if blob?.error}
            <p class="mt-2 text-[12px] leading-snug text-muted">{blob.error}</p>
          {:else}
            <p class="mt-2 flex items-center gap-1.5 text-[12px] text-muted">
              <Loader2 size={11} class="animate-spin" />
              Loading the recording…
            </p>
          {/if}

          {#if media.transcript}
            <p class="mt-2 rounded-xl bg-[#F5F6F8] px-3 py-2 text-[12.5px] italic leading-relaxed text-ink/75">
              “{media.transcript}”
            </p>
          {:else if media.transcription_status && media.transcription_status !== 'completed'}
            <p class="mt-2 text-[12px] leading-snug text-muted">
              {TRANSCRIPTION_NOTES[media.transcription_status] || 'No transcript was returned.'}
            </p>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{:else if listState === 'error' && listError}
  <div class="card px-3.5 py-2.5">
    <p class="text-[12px] leading-snug text-muted">{listError}</p>
  </div>
{/if}
