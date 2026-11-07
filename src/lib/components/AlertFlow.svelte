<script>
  import { onDestroy } from 'svelte'
  import { fade, scale } from 'svelte/transition'
  import {
    X,
    Phone,
    MessageCircle,
    ShieldCheck,
    Check,
    MapPin,
    Radio,
    Navigation,
    HeartPulse,
    Car,
    Loader2,
    AlertTriangle,
    Mic,
    Square,
  } from '@lucide/svelte'
  import { sos as sosApi } from '$lib/api.js'
  import MapCard from './MapCard.svelte'
  import { MIC_HELP, micBlockReason, micErrorText, micPermissionState } from '$lib/mic.js'
  import { sendBreadcrumb } from '$lib/tracking.js'
  import { initialsFor, formatDistance, formatEta, timeAgo } from '$lib/alertMeta.js'
  import { retrySeconds, formatCooldown } from '$lib/rateLimit.js'

  let {
    onclose,
    onnotify,
    ontrack,
    live = null,
    coords = { lat: -8.65, lng: 115.22 },
  } = $props()

  // ---- phases: 'describe' | 'count' | 'sending' | 'active' | 'ended' | 'error' ----
  // The countdown is also the audio-capture window, so it is measured in seconds
  // of speech the backend gets to classify.
  const total = 10
  let phase = $state('describe')
  let description = $state('')
  let countdown = $state(total)
  let elapsed = $state(0)
  let acknowledged = $state(false)
  // How many responders the backend says are coming (`responders_en_route` on
  // the alert detail) and who they are (`responders`, participant-only).
  let respondersEnRoute = $state(0)
  let respondersOnWay = $state([])
  let confirming = $state(false)
  let errorMsg = $state('')
  let rateLimited = $state(false)

  // ---- 10 s audio evidence ----
  const MAX_MEDIA_SECONDS = 10
  let mediaState = $state('idle') // idle | starting | recording | uploading | uploaded | error
  let mediaSeconds = $state(MAX_MEDIA_SECONDS)
  let mediaError = $state('')
  let mediaUploads = $state(0)
  // Countdown capture, kept apart from the manual evidence recorder so the SOS
  // screen can say whether the classification is getting audio.
  let captureState = $state('idle') // idle | starting | recording | blocked | failed
  let captureError = $state('')
  let capturePromise = null
  let transcript = $state('')
  let transcriptionStatus = $state('')
  let triageFromAudio = $state(false)
  // Pre-trigger classification (POST /api/sos/classify) and the fan-out the
  // backend widened when the audio raised the severity after the trigger.
  let classifying = $state(false)
  let classifyError = $state('')
  let escalated = $state(false)
  let recipientsAdded = $state(0)
  let mediaRecorder = null
  let mediaStream = null
  let mediaTimer = null
  let mediaChunks = []
  let clipWaiter = null
  let destroyed = false

  // Permission state, so the SOS screen can explain a blocked microphone
  // before the user taps record — browsers only show that dialog once.
  let micState = $state('unknown')
  $effect(() => {
    if (phase !== 'active') return
    let cancelled = false
    micPermissionState().then((state) => {
      if (!cancelled) micState = state
    })
    return () => {
      cancelled = true
    }
  })

  const liveStatus = $derived(live?.status || null)
  const liveConnection = $derived(live?.connection || 'idle')
  const connectionLabel = $derived(
    liveConnection === 'open'
      ? 'Live'
      : liveConnection === 'reconnecting'
        ? 'Reconnecting…'
        : liveConnection === 'error'
          ? 'Offline'
          : 'Connecting…',
  )

  // Real data from the backend response.
  let alertId = $state('')
  let recipientsNotified = $state(0)
  let triageResult = $state(null)
  let triggeredAt = $state(null)

  // Severity display config.
  const RING = 2 * Math.PI * 44
  const TRIAGE_LABELS = { MEDICAL: 'Medical emergency', ACCIDENT: 'Accident', DANGER: 'Threat / danger' }
  // The badge used to print the raw enum (ACCIDENT) inside a 36px box, where it
  // overflowed and read as a second, overlapping copy of the label underneath.
  const TRIAGE_ICONS = { MEDICAL: HeartPulse, ACCIDENT: Car, DANGER: AlertTriangle }
  const TypeIcon = $derived(TRIAGE_ICONS[triageResult?.emergency_type] || AlertTriangle)
  // Same tiers as the radius copy below the severity bar, so the circle on the
  // map matches what the text claims.
  const fanoutRadiusM = $derived(
    triageResult?.severity >= 0.67 ? 5000 : triageResult?.severity >= 0.34 ? 2000 : 1000,
  )
  // The sender's own position for the map: the live tracking frame once the
  // socket reports, the app's last fix before that.
  const mapPosition = $derived(
    Number.isFinite(live?.latitude) && Number.isFinite(live?.longitude)
      ? { latitude: live.latitude, longitude: live.longitude }
      : { latitude: coords.lat, longitude: coords.lng },
  )
  const TRIAGE_COLORS = { MEDICAL: 'text-[#FFB3B3]', ACCIDENT: 'text-[#FFD580]', DANGER: 'text-[#FF8080]' }
  const TRIAGE_BG = { MEDICAL: 'from-[#FF4A3F] via-[#CC2019] to-[#991510]', ACCIDENT: 'from-[#FF8C00] via-[#CC6600] to-[#994400]', DANGER: 'from-[#B81710] via-[#99100A] to-[#6B0A06]' }
  const TRIAGE_BG_CARD = { MEDICAL: 'bg-[#FFECEB]', ACCIDENT: 'bg-[#FFF6E5]', DANGER: 'bg-[#FFE8E6]' }
  const TRIAGE_TEXT_CARD = { MEDICAL: 'text-[#8f1d17]', ACCIDENT: 'text-[#8a5a00]', DANGER: 'text-[#7a0c07]' }

  function pad(v) { return String(v).padStart(2, '0') }
  function elapsedLabel(s) { return `${pad(Math.floor(s / 60))}:${pad(s % 60)}` }
  function sevLabel(s) { return `${Math.round(s * 100)}%` }
  function sevColor(s) { return s >= 0.67 ? 'text-[#FF8080]' : s >= 0.34 ? 'text-[#FFD580]' : 'text-[#A8E6CF]' }
  function sevBar(s) { return `w-[${Math.round(s * 100)}%]` }

  // The backend re-classifies from the audio transcript: the media upload
  // answers with `triage` and the tracking socket broadcasts ALERT_TRIAGE.
  // Both land here, so the card, the severity bar and the radius copy all
  // follow the newest classification.
  //
  // A payload with nothing to classify (STT disabled, no speech detected) only
  // carries `transcription_status`, so it must not invent a level from the
  // previous state nor claim the audio produced the level on screen.
  function applyTriage(next, fromAudio = false) {
    if (!next) return
    const hasType = !!next.emergency_type
    const hasSeverity = Number.isFinite(next.severity)
    if (!hasType && !hasSeverity) return
    triageResult = {
      emergency_type: next.emergency_type || triageResult?.emergency_type || 'DANGER',
      severity: hasSeverity ? next.severity : (triageResult?.severity ?? 0.5),
      summary: next.summary || triageResult?.summary || '',
    }
    if (fromAudio) triageFromAudio = true
  }

  const TRANSCRIPTION_NOTES = {
    disabled: 'Transcription is off on the server, so the classification stays on your description.',
    too_large: 'The audio was too large to transcribe.',
    empty: 'No speech was recognized in the audio.',
    failed: 'Transcription failed — the description classification stands.',
  }
  const triageSourceLabel = $derived(
    triageFromAudio ? 'from your audio' : 'from your description',
  )
  // Everyone the alert reached: the first fan-out plus the responders the
  // backend added when the audio raised the priority.
  const notifiedTotal = $derived(recipientsNotified + recipientsAdded)
  // The alert detail (polled) and the RESPONDER_ADDED frames carry the same
  // shape; the stream is fresher, so it wins per responder. Nearest first.
  const respondersList = $derived.by(() => {
    const byId = new Map()
    for (const person of respondersOnWay) {
      if (person?.user_id) byId.set(person.user_id, person)
    }
    for (const person of live?.responders || []) {
      if (person?.user_id) byId.set(person.user_id, person)
    }
    return [...byId.values()].sort(
      (a, b) => (Number(a.distance_m) || 0) - (Number(b.distance_m) || 0),
    )
  })
  // Either the list, the detail poll or the ALERT_STATUS frame can vouch for a
  // responder; the list is empty for viewers who only get the bare count.
  const respondedCount = $derived(
    Math.max(respondersList.length, respondersEnRoute, acknowledged ? 1 : 0),
  )
  // "240 m away · ETA 3 min · 2 min ago". The backend records the distance and
  // ETA at answer time, so they describe where the responder was when they set
  // off, not where they are now.
  function responderMeta(person) {
    return [
      Number.isFinite(person?.distance_m) ? `${formatDistance(person.distance_m)} away` : '',
      person?.eta_seconds ? `ETA ${formatEta(person.eta_seconds)}` : '',
      Number.isFinite(person?.responded_at) ? timeAgo(person.responded_at) : '',
    ]
      .filter(Boolean)
      .join(' · ')
  }

  const responderStatusLabel = $derived(
    respondedCount > 0
      ? `${respondedCount} responder${respondedCount === 1 ? '' : 's'} on the way`
      : 'Waiting for responders',
  )

  async function doTrigger() {
    if (destroyed) return
    // Real API call. Let navigator location override prop coords if available.
    const pos = await new Promise((res) => {
      if (navigator.geolocation) navigator.geolocation.getCurrentPosition(
        (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => res(coords),
        { enableHighAccuracy: true, timeout: 8000 },
      )
      else res(coords)
    })

    // The clip from the countdown. Classify it first so the first fan-out
    // already uses the audio level: explicit `emergency_type`/`severity`/
    // `summary` win over the description triage, and severity picks the
    // adaptive radius. classify() persists nothing, so the clip is uploaded
    // again below as the evidence responders can listen to.
    const clip = capturePromise ? await capturePromise : null
    capturePromise = null
    let audioTriage = null
    if (clip) {
      classifying = true
      classifyError = ''
      try {
        const classified = await sosApi.classify(
          clip.blob,
          `sos-classify-${Date.now()}.${clip.extension}`,
        )
        if (classified?.emergency_type) audioTriage = classified
        applyTriage(classified, true)
        if (classified?.transcript) transcript = classified.transcript
        transcriptionStatus = classified?.transcription_status || ''
      } catch (err) {
        // 503 (STT off) / 502 (provider down) / 400 / offline: send the SOS on
        // the description triage instead. The media upload below re-classifies
        // from the same clip, and the backend widens the fan-out if that raises
        // the severity.
        classifyError = err?.status ? `HTTP ${err.status}` : err?.message || 'unavailable'
      } finally {
        classifying = false
      }
    }

    const fields = {
      latitude: pos.lat,
      longitude: pos.lng,
      description: description.trim(),
    }
    if (audioTriage) {
      fields.emergency_type = audioTriage.emergency_type
      if (Number.isFinite(audioTriage.severity)) fields.severity = audioTriage.severity
      if (audioTriage.summary) fields.summary = audioTriage.summary
    }

    let result
    try {
      result = await sosApi.trigger(fields)
    } catch (err) {
      if (err?.status === 429) {
        rateLimited = true
        const wait = retrySeconds(err)
        errorMsg = wait
          ? `SOS limit reached. Try again in ${formatCooldown(wait)}.`
          : err?.message || 'SOS limit reached: max 3 triggers per hour.'
      } else {
        errorMsg = err?.message || 'Failed to send SOS. Check connection.'
      }
      phase = 'error'
      return
    }

    alertId = result.alert_id
    recipientsNotified = result.recipients_notified || 0
    triggeredAt = result.triggered_at ? new Date(result.triggered_at) : null
    applyTriage(result.triage)
    ontrack?.(result.alert_id, {
      status: result.status,
      latitude: pos.lat,
      longitude: pos.lng,
      updatedAt: result.triggered_at,
    })
    phase = 'active'

    // Evidence upload: the media row is what lets responders listen to the
    // clip. Its response can still escalate the fan-out when this ran as the
    // fallback path (no pre-trigger classification).
    if (clip && !destroyed) uploadClip(clip.blob, clip.extension)
  }

  async function doResolve() {
    if (!alertId) { phase = 'ended'; return }
    try { await sosApi.resolve(alertId) } catch { /* best-effort */ }
    phase = 'ended'
  }

  function stop() {
    onnotify?.('SOS cancelled. No alert was sent.')
    onclose?.()
  }

  function backHome() {
    onnotify?.("You're marked safe. Alert ended.")
    onclose?.()
  }

  function endAlert() {
    if (!confirming) { confirming = true; return }
    confirming = false
    doResolve()
  }

  // ---- audio ----
  // The countdown records one clip the backend transcribes and classifies; the
  // active screen can add evidence clips on top of it. Both paths share the
  // recorder helpers below.
  function pickAudioMime() {
    if (typeof MediaRecorder === 'undefined') return ''
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ]
    return (
      candidates.find(
        (type) => !MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(type),
      ) || ''
    )
  }

  function stopTracks() {
    mediaStream?.getTracks().forEach((track) => track.stop())
    mediaStream = null
  }

  // Drops whatever is being recorded and releases the microphone. A caller
  // waiting for a clip is answered with null, never left hanging.
  function cleanupMedia() {
    clearInterval(mediaTimer)
    mediaTimer = null
    if (mediaRecorder) {
      mediaRecorder.onstop = null
      mediaRecorder.ondataavailable = null
      try {
        if (mediaRecorder.state !== 'inactive') mediaRecorder.stop()
      } catch {
        /* already stopped */
      }
      mediaRecorder = null
    }
    stopTracks()
    mediaChunks = []
    clipWaiter?.(null)
    clipWaiter = null
  }

  // Opens the microphone and starts a 250 ms-chunk recorder. The caller decides
  // what the clip is for by what it does when the recorder stops.
  async function openRecorder() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    mediaStream = stream
    const mimeType = pickAudioMime()
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    mediaRecorder = recorder
    mediaChunks = []
    recorder.ondataavailable = (event) => {
      if (event.data?.size) mediaChunks.push(event.data)
    }
    recorder.onstop = () => finalizeRecording(recorder)
    recorder.start(250)
    return recorder
  }

  // ---- countdown capture: the SOS window doubles as the audio window ----
  async function startCapture() {
    if (captureState === 'starting' || captureState === 'recording') return
    const blocked = micBlockReason()
    if (blocked) {
      captureState = 'blocked'
      captureError = MIC_HELP[blocked]
      return
    }
    captureState = 'starting'
    captureError = ''
    try {
      await openRecorder()
      if (destroyed || phase !== 'count') {
        // Cancelled or moved on while the device was opening.
        cleanupMedia()
        captureState = 'idle'
        return
      }
      captureState = 'recording'
    } catch (err) {
      cleanupMedia()
      captureState = 'failed'
      captureError = micErrorText(err)
    }
  }

  // Stops the countdown recorder and resolves with the assembled clip, or null
  // when there is nothing to send (blocked microphone, cancel, empty audio).
  function stopCapture() {
    if (!mediaRecorder) return Promise.resolve(null)
    const pending = new Promise((resolve) => {
      clipWaiter = resolve
    })
    try {
      if (mediaRecorder.state !== 'inactive') mediaRecorder.stop()
      else cleanupMedia()
    } catch {
      cleanupMedia()
    }
    return pending
  }

  // ---- manual evidence clip on the active screen ----
  async function startRecording() {
    if (
      !alertId ||
      phase !== 'active' ||
      mediaState === 'starting' ||
      mediaState === 'recording' ||
      mediaState === 'uploading'
    ) {
      return
    }
    const blocked = micBlockReason()
    if (blocked) {
      mediaState = 'error'
      mediaError = MIC_HELP[blocked]
      return
    }

    mediaError = ''
    mediaState = 'starting'
    try {
      await openRecorder()
      if (destroyed || phase !== 'active') {
        cleanupMedia()
        mediaState = 'idle'
        return
      }
      mediaState = 'recording'
      mediaSeconds = MAX_MEDIA_SECONDS
      clearInterval(mediaTimer)
      mediaTimer = setInterval(() => {
        mediaSeconds = Math.max(0, mediaSeconds - 1)
        if (mediaSeconds === 0) stopRecording()
      }, 1000)
    } catch (err) {
      cleanupMedia()
      mediaState = 'error'
      mediaError = micErrorText(err)
    }
  }

  function stopRecording() {
    clearInterval(mediaTimer)
    mediaTimer = null
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try {
        mediaRecorder.stop()
      } catch {
        cleanupMedia()
        mediaState = 'idle'
      }
    }
  }

  async function finalizeRecording(recorder) {
    clearInterval(mediaTimer)
    mediaTimer = null
    mediaRecorder = null
    stopTracks()
    if (captureState === 'recording' || captureState === 'starting') captureState = 'idle'

    const chunks = mediaChunks
    mediaChunks = []
    const type = recorder.mimeType || chunks[0]?.type || 'audio/webm'
    const blob = new Blob(chunks, { type })
    const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'

    const waiter = clipWaiter
    clipWaiter = null

    if (destroyed) {
      waiter?.(null)
      return
    }
    if (!blob.size) {
      if (waiter) {
        waiter(null)
        captureState = 'failed'
        captureError = 'No audio was captured.'
      } else {
        mediaState = 'error'
        mediaError = 'No audio was captured. Try again.'
      }
      return
    }
    // Countdown clip: there is no alert to attach it to yet, so the waiter in
    // doTrigger takes it and uploads once the trigger answered with an id.
    if (waiter) {
      waiter({ blob, extension })
      return
    }
    await uploadClip(blob, extension)
  }

  // Uploads one clip. The response carries the transcript and the triage the
  // backend derived from it, so the active screen can move off the
  // description-based classification.
  async function uploadClip(blob, extension) {
    mediaState = 'uploading'
    mediaError = ''
    try {
      const result = await sosApi.uploadMedia(
        alertId,
        blob,
        `sos-${alertId}-${Date.now()}.${extension}`,
      )
      if (destroyed) return
      mediaUploads += 1
      mediaState = 'uploaded'
      if (result?.transcript) transcript = result.transcript
      transcriptionStatus = result?.transcription_status || ''
      applyTriage(result?.triage, true)
      // The backend widens the fan-out when this transcript raises the
      // severity above what the first fan-out used, and reports the delta.
      if (result?.escalated) {
        escalated = true
        recipientsAdded += result?.recipients_added || 0
      }
    } catch (err) {
      if (destroyed) return
      mediaState = 'error'
      mediaError =
        err?.status === 412
          ? 'Media storage is not configured on the server.'
          : err?.message || 'Could not upload the audio.'
    }
  }

  onDestroy(() => {
    destroyed = true
    cleanupMedia()
  })

  // Recording only makes sense on the countdown or the active screen; a cancel,
  // a failed trigger or the end of the alert drops the clip and the microphone.
  $effect(() => {
    if (phase === 'count' || phase === 'sending' || phase === 'active') return
    const manual = mediaState === 'recording' || mediaState === 'starting'
    const capture = captureState === 'recording' || captureState === 'starting'
    if (!manual && !capture) return
    cleanupMedia()
    if (manual) {
      mediaState = 'idle'
      mediaSeconds = MAX_MEDIA_SECONDS
    }
    if (capture) captureState = 'idle'
  })

  // A later transcription can raise or lower the severity; ALERT_TRIAGE arrives
  // on the tracking socket and re-labels the card while the alert is open.
  $effect(() => {
    const update = live?.triage
    if (update) applyTriage(update, true)
  })

  function startCountdown() {
    if (!description.trim()) { description = 'Emergency'; }
    rateLimited = false
    errorMsg = ''
    phase = 'count'
    countdown = total
    // Opens the microphone straight away: `total` seconds of audio is what the
    // backend classifies, so a slow permission prompt eats into the window.
    startCapture()
  }

  // ---- timers ----
  let timerId
  // The countdown is the user's cancel window *and* the audio-capture window:
  // the alert is only POSTed once it runs out, so "Cancel alert" stays a real
  // local abort for the whole time (no request in flight, nothing to undo on the
  // backend) and the clip can be thrown away with it. The deadline is absolute
  // and re-checked on visibilitychange because a backgrounded tab throttles
  // timers — switching to the dialer mid-countdown must not swallow the SOS.
  $effect(() => {
    if (phase !== 'count') return
    const deadline = Date.now() + total * 1000
    let fired = false
    const tick = () => {
      if (fired) return
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      countdown = remaining
      if (remaining > 0) return
      fired = true
      clearInterval(timerId)
      timerId = null
      capturePromise = stopCapture()
      phase = 'sending'
      doTrigger()
    }
    timerId = setInterval(tick, 250)
    const onVisible = () => {
      if (!document.hidden) tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timerId)
      document.removeEventListener('visibilitychange', onVisible)
    }
  })

  $effect(() => {
    if (phase === 'active') {
      const id = setInterval(() => (elapsed += 1), 1000)
      return () => clearInterval(id)
    }
  })

  // The sender's only source for how many people are coming is the alert detail
  // (`responders_en_route`); nothing in the API reports who they are or how far
  // away, so refresh the number while the alert is open. `status` doubles as a
  // fallback in case the socket frame was missed.
  $effect(() => {
    if (phase !== 'active' || !alertId) return
    let cancelled = false
    const load = async () => {
      try {
        const detail = await sosApi.get(alertId)
        if (cancelled || !detail) return
        if (Number.isFinite(detail.responders_en_route)) {
          respondersEnRoute = detail.responders_en_route
        }
        // Participant-only: other viewers keep the bare count.
        if (Array.isArray(detail.responders)) respondersOnWay = detail.responders
        if (detail.status === 'ACKNOWLEDGED') acknowledged = true
      } catch {
        /* the alert poll is best-effort; App owns the 401 handling */
      }
    }
    load()
    const timer = setInterval(load, 10000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  })

  // ---- WebSocket live tracking (sender) ----
  let watchId = null
  let lastBreadcrumb = null
  let lastSentAt = 0

  function emitBreadcrumb(force = false) {
    if (!lastBreadcrumb) return
    const now = Date.now()
    if (!force && now - lastSentAt < 4000) return
    lastSentAt = now
    sendBreadcrumb(lastBreadcrumb)
  }

  $effect(() => {
    if (phase !== 'active') return

    lastBreadcrumb = { latitude: coords.lat, longitude: coords.lng }
    emitBreadcrumb(true)

    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          lastBreadcrumb = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy_meters: pos.coords.accuracy,
            speed_mps: Number.isFinite(pos.coords.speed) ? pos.coords.speed : undefined,
            heading_deg: Number.isFinite(pos.coords.heading) ? pos.coords.heading : undefined,
          }
          emitBreadcrumb()
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
      )
    }

    const timer = setInterval(() => emitBreadcrumb(true), 5000)

    return () => {
      clearInterval(timer)
      if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId)
      watchId = null
    }
  })

  $effect(() => {
    if (phase !== 'active') return
    if (liveStatus === 'ACKNOWLEDGED') acknowledged = true
    if (liveStatus === 'RESOLVED' || liveStatus === 'CANCELLED' || liveStatus === 'EXPIRED') {
      phase = 'ended'
    }
  })

  function onKeydown(e) {
    if (e.key !== 'Escape') return
    if (phase === 'describe') stop()
    else if (phase === 'ended') backHome()
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="absolute inset-0 z-50 flex flex-col overflow-hidden"
  transition:fade={{ duration: 220 }}
  role="dialog"
  aria-modal="true"
  aria-label="Emergency SOS"
>

{#if phase === 'describe'}
  <!-- PHASE 1: DESCRIPTION INPUT -->
  <div class="absolute inset-0 bg-gradient-to-b from-[#FF4A3F] via-[#EE2B22] to-[#B81710]"></div>
  <div class="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-white/15 blur-3xl"></div>
  <div class="pointer-events-none absolute -bottom-32 -right-16 h-80 w-80 rounded-full bg-[#7A0C07]/40 blur-3xl"></div>

  <div class="relative flex h-full flex-col px-6 pb-8 pt-7 text-white">
    <div class="flex items-center justify-between">
      <span class="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ring-1 ring-white/20 backdrop-blur">
        <AlertTriangle size={12} />
        AI Emergency Assessment
      </span>
      <button
        type="button" aria-label="Cancel" onclick={stop}
        class="grid h-9 w-9 place-items-center rounded-full bg-white/15 ring-1 ring-white/20 backdrop-blur transition hover:bg-white/25 active:scale-95"
      >
        <X size={17} />
      </button>
    </div>

    <div class="flex flex-1 flex-col items-center justify-center">
      <div class="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25">
        <AlertTriangle size={28} class="text-white" strokeWidth={2} />
      </div>

      <h2 class="text-center text-[22px] font-semibold tracking-[-0.02em]">
        What happened?
      </h2>
      <p class="mt-2 max-w-[270px] text-center text-[12.5px] leading-relaxed text-white/70">
        Describe briefly — the AI will classify urgency and find the right responders nearby.
      </p>

      <div class="mt-5 w-full max-w-[300px]">
        <textarea
          bind:value={description}
          rows="3"
          placeholder="e.g. Ada orang pingsan di pantai dan tidak sadar"
          aria-label="Emergency description"
          class="w-full resize-none rounded-2xl bg-white/15 px-4 py-3 text-[13px] font-medium text-white placeholder:text-white/50 outline-none ring-1 ring-white/20 focus:ring-2 focus:ring-white/50 backdrop-blur"
        ></textarea>
      </div>

      <!-- Severity preview hint -->
      <div class="mt-3 flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-[11px] text-white/60">
        <span class="h-1.5 w-1.5 rounded-full bg-[#FFD580]"></span>
        The next 10 s are recorded, then classified by AI
      </div>
    </div>

    <div class="space-y-2.5">
      <button
        type="button"
        onclick={startCountdown}
        class="w-full rounded-full bg-white py-3.5 text-[13.5px] font-semibold text-[#C41912] shadow-lg transition active:scale-[0.98]"
      >
        Continue → Send SOS
      </button>
      <p class="text-center text-[10.5px] text-white/60">
        10 seconds of audio for AI triage — cancel before it ends to send nothing.
      </p>
    </div>
  </div>

{:else if phase === 'count' || phase === 'sending'}
  <!-- PHASE 2: COUNTDOWN → SENDING -->
  <div class="absolute inset-0 bg-gradient-to-b from-[#FF4A3F] via-[#EE2B22] to-[#B81710]"></div>
  <div class="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-white/15 blur-3xl"></div>
  <div class="pointer-events-none absolute -bottom-32 -right-16 h-80 w-80 rounded-full bg-[#7A0C07]/40 blur-3xl"></div>

  <div class="relative flex h-full flex-col px-6 pb-8 pt-7 text-white">
    <div class="flex items-center justify-between">
      <span class="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ring-1 ring-white/20 backdrop-blur">
        <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-white"></span>
        Emergency SOS
      </span>
      {#if phase === 'count'}
        <button
          type="button" aria-label="Cancel SOS" onclick={stop}
          class="grid h-9 w-9 place-items-center rounded-full bg-white/15 ring-1 ring-white/20 backdrop-blur transition hover:bg-white/25 active:scale-95"
        >
          <X size={17} />
        </button>
      {/if}
    </div>

    {#if phase === 'count'}
      <div class="flex flex-1 flex-col items-center justify-center" in:fade={{ duration: 180 }}>
        <div class="relative grid h-[212px] w-[212px] place-items-center">
          <span class="absolute h-[196px] w-[196px] rounded-full border border-white/20"></span>
          <span class="absolute h-[196px] w-[196px] rounded-full bg-white/5 animate-breathe"></span>
          <svg class="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="2.5" />
            <circle
              cx="50" cy="50" r="44" fill="none" stroke="#fff" stroke-width="2.5"
              stroke-linecap="round" stroke-dasharray={RING}
              stroke-dashoffset={RING * (1 - countdown / total)}
              style="transition: stroke-dashoffset 1s linear"
            />
          </svg>
          <div class="flex flex-col items-center">
            <span class="text-[86px] font-semibold leading-none tracking-[-0.06em] tabular-nums">{countdown}</span>
            <span class="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70">seconds</span>
          </div>
        </div>
        <h2 class="mt-7 text-center text-[22px] font-semibold tracking-[-0.02em]">Sending SOS in {countdown}</h2>
        <p class="mt-2 max-w-[280px] text-center text-[12.5px] leading-relaxed text-white/70">
          {#if captureState === 'recording'}
            Recording audio — the AI classifies it and alerts the nearest responders when the countdown ends.
          {:else if captureState === 'starting'}
            Opening the microphone before the SOS goes out…
          {:else}
            The AI classifies your alert and alerts the nearest responders when the countdown ends.
          {/if}
        </p>

        <div
          class="mt-5 flex max-w-[300px] items-center gap-2 rounded-full px-3.5 py-2 text-[11px] font-medium ring-1 backdrop-blur {captureState ===
          'recording'
            ? 'bg-white/20 text-white ring-white/25'
            : 'bg-white/10 text-white/70 ring-white/15'}"
        >
          {#if captureState === 'recording'}
            <span class="relative flex h-2 w-2">
              <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-70"></span>
              <span class="relative inline-flex h-2 w-2 rounded-full bg-sos"></span>
            </span>
            <Mic size={12} />
            Audio evidence recording · {countdown}s left
          {:else if captureState === 'starting'}
            <Loader2 size={12} class="animate-spin" />
            Starting microphone…
          {:else}
            <Mic size={12} />
            Sending without audio
          {/if}
        </div>
        {#if captureError}
          <p class="mt-2 max-w-[300px] text-center text-[10px] leading-snug text-white/70">
            {captureError}
          </p>
        {/if}
      </div>
      <div class="space-y-2.5">
        <button type="button" onclick={stop}
          class="w-full rounded-full bg-white py-3.5 text-[13.5px] font-semibold text-[#C41912] shadow-lg transition active:scale-[0.98]">
          Cancel alert
        </button>
        <p class="text-center text-[10.5px] text-white/60">Accidental tap? You can still cancel.</p>
      </div>
    {:else}
      <div class="flex flex-1 flex-col items-center justify-center" in:fade={{ duration: 180 }}>
        <div class="relative grid h-[164px] w-[164px] place-items-center">
          <span class="absolute h-[150px] w-[150px] rounded-full bg-white/10 animate-sos-pulse"></span>
          <span class="absolute h-[150px] w-[150px] rounded-full bg-white/10 animate-sos-pulse" style="animation-delay: 1s"></span>
          <span class="grid h-[104px] w-[104px] place-items-center rounded-full bg-white/15 ring-1 ring-white/25 backdrop-blur">
            <Radio size={42} strokeWidth={1.8} class="text-white" />
          </span>
        </div>
        <h2 class="mt-8 text-center text-[22px] font-semibold tracking-[-0.02em]">
          {classifying ? 'AI listening to your audio' : 'Alerting nearby responders'}
        </h2>
        <p class="mt-2 text-center text-[12.5px] text-white/70">
          {#if classifying}
            Classifying the {total}s clip so the first alert already carries the audio level…
          {:else}
            Sending your SOS with the classification the audio produced…
          {/if}
        </p>
        <div class="mt-6 flex items-center gap-1.5">
          {#each [0, 1, 2] as dot}
            <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-white/80" style="animation-delay: {dot * 150}ms"></span>
          {/each}
        </div>
      </div>
      <div class="flex items-center justify-center gap-2 text-[10.5px] font-medium text-white/60">
        <Loader2 size={12} class="animate-spin" /> Connecting to responder network & AI triage engine
      </div>
    {/if}
  </div>
  {:else if phase === 'active'}
    <!-- ACTIVE ALERT -->
    <div class="absolute inset-0 bg-gradient-to-b from-[#14171D] via-[#0F1216] to-[#0B0D11]"></div>
    <div
      class="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-sos/30 blur-3xl"
    ></div>
    <div
      class="pointer-events-none absolute -bottom-24 -right-20 h-64 w-64 rounded-full bg-[#2F6BFF]/15 blur-3xl"
    ></div>

    <div
      class="relative flex h-full flex-col overflow-y-auto px-5 pb-7 pt-6 text-white no-scrollbar"
      in:fade={{ duration: 200 }}
    >
      <div class="flex items-center justify-between">
        <span
          class="inline-flex items-center gap-2 rounded-full bg-sos/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#FF8A82] ring-1 ring-sos/25"
        >
          <span class="relative flex h-1.5 w-1.5">
            <span class="absolute h-full w-full animate-ping rounded-full bg-sos"></span>
            <span class="relative h-1.5 w-1.5 rounded-full bg-sos"></span>
          </span>
          SOS active
        </span>
        <div class="text-right">
          <p class="text-[9px] font-semibold uppercase tracking-[0.16em] text-white/40">Elapsed</p>
          <p class="text-[17px] font-semibold tabular-nums leading-tight">{elapsedLabel(elapsed)}</p>
        </div>
      </div>

      <div class="mt-5">
        <h2 class="text-[25px] font-semibold leading-tight tracking-[-0.03em]">Help is on the way</h2>
        <p class="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-white/50">
          <MapPin size={12} class="text-sos" />
          {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)} · Sharing live location
        </p>
      </div>

      <!-- WHERE HELP IS HEADED: the alert had no map at all before, so the
           sender could not see themselves, the fan-out radius or the live pin. -->
      <div class="mt-4">
        <MapCard
          height="h-[168px]"
          own={mapPosition}
          radiusM={fanoutRadiusM}
          radiusLabel={`Live · ${fanoutRadiusM >= 1000 ? `${fanoutRadiusM / 1000} km` : `${fanoutRadiusM} m`} radius`}
          showFooter={false}
        />
      </div>

      <!-- AI TRIAGE RESULT CARD -->
      {#if triageResult}
        <div class="mt-4 overflow-hidden rounded-2xl bg-white/[0.06] ring-1 ring-white/[0.1]">
          <div class="flex items-center justify-between gap-2 bg-white/[0.05] px-3.5 py-2.5">
            <span class="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-white/50">
              <Radio size={11} class="text-[#6EE7B7]" />
              AI triage · {triageSourceLabel}
            </span>
            <span
              class="text-[9.5px] font-semibold {liveConnection === 'open'
                ? 'text-[#6EE7B7]'
                : liveConnection === 'error'
                  ? 'text-[#FF8080]'
                  : 'text-[#FFD580]'}"
              >{connectionLabel}</span
            >
          </div>
          <div class="p-3.5">
            <div class="flex items-center gap-2.5">
              <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10">
                <TypeIcon size={17} strokeWidth={2.2} class={TRIAGE_COLORS[triageResult.emergency_type] || 'text-white'} />
              </span>
              <div class="min-w-0 flex-1">
                <p class="text-[13px] font-semibold text-white">
                  {TRIAGE_LABELS[triageResult.emergency_type] || triageResult.emergency_type}
                </p>
                {#if triageResult.summary}
                  <p class="mt-0.5 text-[10.5px] leading-snug text-white/55">{triageResult.summary}</p>
                {/if}
              </div>
            </div>
            <div class="mt-3">
              <div class="flex items-center justify-between text-[9.5px] font-semibold uppercase tracking-[0.1em] text-white/45">
                <span>Severity</span>
                <span class="{sevColor(triageResult.severity)}">{sevLabel(triageResult.severity)}</span>
              </div>
              <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div class="h-full rounded-full bg-gradient-to-r from-[#FFD580] to-[#FF8080] {sevBar(triageResult.severity)}"></div>
              </div>
              <p class="mt-1.5 text-[9.5px] text-white/40">
                {#if triageResult.severity >= 0.67}
                  High priority — dispatching to the widest responder radius (5 km).
                {:else if triageResult.severity >= 0.34}
                  Medium priority — dispatching to the mid responder radius (2 km).
                {:else}
                  Low priority — dispatching to the closest responders (1 km).
                {/if}
              </p>
            </div>

            {#if mediaState === 'uploading' && !triageFromAudio}
              <p class="mt-3 flex items-center gap-1.5 text-[9.5px] text-white/45">
                <Loader2 size={11} class="animate-spin" />
                Reading the recorded audio…
              </p>
            {/if}

            {#if transcript}
              <div class="mt-3 rounded-xl bg-white/[0.06] px-3 py-2.5">
                <p class="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/35">
                  Audio transcript · {total} s clip
                </p>
                <p class="mt-1 text-[11.5px] italic leading-relaxed text-white/80">“{transcript}”</p>
              </div>
            {:else if triageFromAudio}
              <p class="mt-3 text-[9.5px] leading-snug text-white/40">
                The audio classified this alert, but the server returned no transcript text.
              </p>
            {/if}

            {#if transcriptionStatus && transcriptionStatus !== 'completed' && !triageFromAudio}
              <p class="mt-2 text-[9.5px] leading-snug text-white/40">
                {TRANSCRIPTION_NOTES[transcriptionStatus] || ''}
              </p>
            {/if}

            {#if classifyError && !triageFromAudio}
              <p class="mt-2 text-[9.5px] leading-snug text-white/40">
                Pre-trigger audio classification unavailable ({classifyError}) — this level came
                from your description.
              </p>
            {/if}
          </div>
        </div>
      {/if}

      <!-- AUDIO EVIDENCE -->
      <div class="mt-4 rounded-2xl bg-white/[0.035] p-3.5 ring-1 ring-white/[0.06]">
        <div class="flex items-center justify-between gap-2">
          <p
            class="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-white/35"
          >
            <Mic size={11} /> Audio evidence
          </p>
          <span class="text-[9px] text-white/30">max 10 s · responder-only</span>
        </div>

        {#if mediaState === 'recording'}
          <div class="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              class="h-full rounded-full bg-sos transition-[width] duration-1000"
              style="width: {((MAX_MEDIA_SECONDS - mediaSeconds) / MAX_MEDIA_SECONDS) * 100}%"
            ></div>
          </div>
        {/if}

        <button
          type="button"
          onclick={mediaState === 'recording' ? stopRecording : startRecording}
          disabled={mediaState === 'starting' || mediaState === 'uploading'}
          class="mt-2.5 flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-[11.5px] font-semibold ring-1 transition disabled:opacity-60 {mediaState ===
          'recording'
            ? 'bg-sos text-white ring-sos'
            : 'bg-white/[0.06] text-white/80 ring-white/10 hover:bg-white/[0.1]'}"
        >
          {#if mediaState === 'recording'}
            <Square size={12} fill="currentColor" />
            Stop recording · {mediaSeconds}s
          {:else if mediaState === 'starting' || mediaState === 'uploading'}
            <Loader2 size={13} class="animate-spin" />
            {mediaState === 'starting' ? 'Starting microphone…' : 'Uploading evidence…'}
          {:else if mediaState === 'uploaded'}
            <Mic size={13} />
            Record another clip
          {:else if mediaState === 'error'}
            <Mic size={13} />
            Try recording again
          {:else}
            <Mic size={13} />
            Record 10 s audio
          {/if}
        </button>

        {#if mediaState === 'uploaded'}
          <p class="mt-2 flex items-center gap-1.5 text-[9.5px] text-[#6EE7B7]">
            <Check size={11} />
            Audio uploaded{mediaUploads > 1 ? ` · ${mediaUploads} clips` : ''}. Only responders can
            access it.
          </p>
        {:else if mediaError}
          <p class="mt-2 text-[9.5px] leading-snug text-[#FF8080]">{mediaError}</p>
        {:else if micState === 'insecure'}
          <p class="mt-2 text-[9.5px] leading-snug text-[#FFD580]">{MIC_HELP.insecure}</p>
        {:else if micState === 'denied'}
          <p class="mt-2 text-[9.5px] leading-snug text-[#FFD580]">{MIC_HELP.denied}</p>
        {:else if micState === 'unsupported'}
          <p class="mt-2 text-[9.5px] leading-snug text-[#FFD580]">{MIC_HELP.unsupported}</p>
        {:else}
          <p class="mt-2 text-[9.5px] leading-snug text-white/35">
            Records ambient audio from your microphone. You can stop early.
          </p>
        {/if}
      </div>

      <div class="mt-4 flex items-center justify-between gap-2 px-0.5">
        <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
          Responders notified · {notifiedTotal}
        </p>
        <span
          class="flex shrink-0 items-center gap-1 text-[10px] font-medium {respondedCount > 0
            ? 'text-[#6EE7B7]'
            : 'text-white/50'}"
        >
          <span
            class="h-1.5 w-1.5 rounded-full {respondedCount > 0
              ? 'bg-[#34D399] animate-live'
              : 'bg-white/40'}"
          ></span>
          {responderStatusLabel}
        </span>
      </div>

      {#if respondersList.length}
        <div
          class="mt-2.5 divide-y divide-white/[0.07] overflow-hidden rounded-2xl bg-white/[0.05] ring-1 ring-white/[0.06]"
        >
          {#each respondersList as person (person.user_id)}
            <div class="flex items-center gap-2.5 px-3.5 py-2.5">
              <span
                class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#0BA36F]/20 text-[9.5px] font-bold text-[#8FF0C6]"
              >
                {initialsFor(person.name || 'Responder')}
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-[11.5px] font-semibold text-white">
                  {person.name || 'Responder'}
                </p>
                {#if responderMeta(person)}
                  <p class="mt-0.5 truncate text-[10px] text-white/50">{responderMeta(person)}</p>
                {/if}
              </div>
              <span
                class="shrink-0 rounded-full bg-[#0BA36F]/15 px-2 py-1 text-[9px] font-semibold text-[#8FF0C6]"
                >On the way</span
              >
            </div>
          {/each}
        </div>
      {:else if respondedCount > 0}
        <div class="mt-2.5 flex items-start gap-2.5 rounded-2xl bg-[#0BA36F]/10 px-3.5 py-3 ring-1 ring-[#0BA36F]/20">
          <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#0BA36F]/20">
            <Navigation size={15} strokeWidth={2.4} class="text-[#6EE7B7]" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-[11.5px] font-semibold text-[#8FF0C6]">
              {respondedCount} {respondedCount === 1 ? 'responder is' : 'responders are'} on the way
            </p>
            <p class="mt-0.5 text-[10px] leading-snug text-[#8FF0C6]/70">
              Stay where you are if it's safe. Names and distances are not part of this alert's
              response.
            </p>
          </div>
        </div>
      {/if}

      {#if liveConnection === 'reconnecting'}
        <p class="mt-2 text-[9.5px] font-medium text-[#FFD580]">
          Live connection lost — reconnecting…
        </p>
      {:else if liveConnection === 'error'}
        <p class="mt-2 text-[9.5px] font-medium text-[#FF8080]">{live?.lastError || 'Live connection unavailable.'}</p>
      {/if}

      <div class="mt-2.5 rounded-2xl bg-white/[0.05] px-4 py-3 ring-1 ring-white/[0.06]">
        <p class="text-[11px] leading-relaxed text-white/50">
          Nearby responders were notified in a <span class="font-semibold text-white/80"
            >{triageResult?.severity >= 0.67 ? '5 km' : triageResult?.severity >= 0.34 ? '2 km' : '1 km'}</span
          > radius based on the AI severity score.
        </p>
        {#if escalated}
          <p class="mt-1.5 flex items-start gap-1.5 text-[10.5px] font-medium text-[#6EE7B7]">
            <Radio size={11} class="mt-px shrink-0" />
            <span
              >The audio raised the priority, so {recipientsAdded} more
              {recipientsAdded === 1 ? 'responder was' : 'responders were'} notified at the wider
              radius.</span
            >
          </p>
        {/if}
      </div>

      <div class="mt-4 grid grid-cols-2 gap-2.5">
        <button
          type="button"
          class="flex items-center justify-center gap-2 rounded-full bg-white py-3 text-[12.5px] font-semibold text-ink transition active:scale-[0.98]"
        >
          <Phone size={15} strokeWidth={2.4} />
          Call 112
        </button>
        <button
          type="button"
          class="flex items-center justify-center gap-2 rounded-full bg-white/10 py-3 text-[12.5px] font-semibold text-white ring-1 ring-white/10 transition hover:bg-white/15 active:scale-[0.98]"
        >
          <MessageCircle size={15} strokeWidth={2.2} />
          Message
        </button>
      </div>

      <div class="mt-4 rounded-2xl bg-white/[0.035] p-3.5 ring-1 ring-white/[0.06]">
        <p class="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/35">While you wait</p>
        <ul class="mt-2 space-y-1.5">
          <li class="flex items-start gap-2 text-[10.5px] leading-snug text-white/55">
            <Check size={12} class="mt-px shrink-0 text-[#6EE7B7]" strokeWidth={2.6} />
            Stay where you are if it's safe and visible.
          </li>
          <li class="flex items-start gap-2 text-[10.5px] leading-snug text-white/55">
            <Check size={12} class="mt-px shrink-0 text-[#6EE7B7]" strokeWidth={2.6} />
            Keep your phone unlocked, sound on.
          </li>
        </ul>
      </div>

      <div class="mt-auto pt-5">
        <button
          type="button"
          onclick={endAlert}
          class="flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-[12.5px] font-semibold ring-1 transition {confirming
            ? 'bg-sos text-white ring-sos'
            : 'bg-white/[0.04] text-white/80 ring-white/10 hover:bg-white/[0.08]'}"
        >
          <ShieldCheck size={15} />
          {confirming ? 'Tap again to end alert' : "I'm safe — end alert"}
        </button>
        <p class="mt-2.5 text-center text-[9.5px] text-white/35">
          Ending the alert stops live location sharing.
        </p>
      </div>
    </div>
  {:else if phase === 'error'}
    <!-- ERROR -->
    <div class="absolute inset-0 bg-[#1A1213]"></div>
    <div class="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-sos/20 blur-3xl"></div>
    <div
      class="relative flex h-full flex-col px-6 pb-8 pt-10 text-white"
      in:fade={{ duration: 200 }}
    >
      <div class="flex flex-1 flex-col items-center justify-center text-center">
        <span class="grid h-20 w-20 place-items-center rounded-full bg-sos/15 ring-1 ring-sos/25">
          <AlertTriangle size={34} class="text-[#FF8080]" strokeWidth={2} />
        </span>
        <h2 class="mt-6 text-[24px] font-semibold tracking-[-0.03em]">
          {rateLimited ? 'SOS limit reached' : 'SOS could not be sent'}
        </h2>
        <p class="mt-2 max-w-[270px] text-[12.5px] leading-relaxed text-white/55">
          {errorMsg ||
            (rateLimited
              ? 'SOS limit reached: max 3 triggers per hour.'
              : 'The alert did not go through. Please try again.')}
        </p>
        <p class="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-[10.5px] text-white/50 ring-1 ring-white/10">
          <Phone size={11} /> In immediate danger, call 112.
        </p>
      </div>
      <div class="space-y-2.5">
        {#if !rateLimited}
          <button
            type="button"
            onclick={() => { phase = 'describe'; errorMsg = '' }}
            class="w-full rounded-full bg-white py-3.5 text-[13.5px] font-semibold text-[#C41912] shadow-lg transition active:scale-[0.98]"
          >
            Try again
          </button>
        {/if}
        <button
          type="button"
          onclick={stop}
          class="w-full rounded-full py-3 text-[12.5px] font-semibold transition {rateLimited
            ? 'bg-white text-ink hover:bg-white/90'
            : 'bg-white/[0.06] text-white/80 ring-1 ring-white/10 hover:bg-white/[0.1]'}"
        >
          Close
        </button>
      </div>
    </div>
  {:else}
    <!-- ENDED -->
    <div class="absolute inset-0 bg-[#0B1512]"></div>
    <div
      class="pointer-events-none absolute left-1/2 top-1/4 h-72 w-72 -translate-x-1/2 rounded-full bg-[#0BA36F]/25 blur-3xl"
    ></div>

    <div class="relative flex h-full flex-col px-6 pb-8 pt-10 text-white" in:fade={{ duration: 200 }}>
      <div class="flex flex-1 flex-col items-center justify-center text-center">
        <div class="relative grid h-24 w-24 place-items-center" transition:scale={{ duration: 260 }}>
          <span class="absolute inset-0 rounded-full bg-[#0BA36F]/20 animate-breathe"></span>
          <span class="grid h-20 w-20 place-items-center rounded-full bg-[#0BA36F] shadow-lg">
            <Check size={38} strokeWidth={2.6} class="text-white" />
          </span>
        </div>

        <h2 class="mt-7 text-[26px] font-semibold tracking-[-0.03em]">You're marked safe</h2>
        <p class="mt-2 max-w-[260px] text-[12.5px] leading-relaxed text-white/55">
          Your alert has ended and live location sharing stopped. Your contacts have been notified.
        </p>

        <div class="mt-6 flex w-full max-w-[280px] divide-x divide-white/10 rounded-2xl bg-white/[0.05] py-3.5 ring-1 ring-white/10">
          <div class="flex-1 text-center">
            <p class="text-[15px] font-semibold">{elapsedLabel(Math.max(elapsed, 1))}</p>
            <p class="mt-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-white/40">Duration</p>
          </div>
          <div class="flex-1 text-center">
            <p class="text-[15px] font-semibold">{acknowledged ? 1 : 0}</p>
            <p class="mt-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-white/40">Responded</p>
          </div>
          <div class="flex-1 text-center">
            <p class="text-[15px] font-semibold">{notifiedTotal}</p>
            <p class="mt-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-white/40">Notified</p>
          </div>
        </div>
      </div>

      <button
        type="button"
        onclick={backHome}
        class="w-full rounded-full bg-white py-3.5 text-[13px] font-semibold text-ink transition active:scale-[0.98]"
      >
        Back to home
      </button>
      <p class="mt-2.5 text-center text-[10px] text-white/35">A summary was saved to your alert history.</p>
    </div>
  {/if}
</div>
