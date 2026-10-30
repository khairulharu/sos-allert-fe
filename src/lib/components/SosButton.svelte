<script>
  let { ontrigger } = $props()

  const HOLD_MS = 850
  let progress = $state(0)
  let holding = $state(false)
  let frame = null
  let startedAt = 0
  let finished = false

  const CIRCUMFERENCE = 2 * Math.PI * 46

  function buzz(pattern) {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern)
    }
  }

  function begin(event) {
    if (holding) return
    if (event?.pointerType === 'mouse' && event.button !== 0) return
    holding = true
    finished = false
    startedAt = performance.now()
    buzz(8)
    frame = requestAnimationFrame(tick)
  }

  function tick() {
    const ratio = Math.min((performance.now() - startedAt) / HOLD_MS, 1)
    progress = ratio
    if (ratio >= 1) {
      complete()
      return
    }
    frame = requestAnimationFrame(tick)
  }

  function cancel() {
    if (frame) cancelAnimationFrame(frame)
    frame = null
    holding = false
    progress = 0
  }

  function complete() {
    if (finished) return
    finished = true
    holding = false
    progress = 1
    buzz([18, 50, 28])
    ontrigger?.()
    setTimeout(() => {
      progress = 0
    }, 450)
  }

  function onkeydown(event) {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      if (!event.repeat) begin()
    }
  }

  function onkeyup(event) {
    if (event.key === ' ' || event.key === 'Enter') cancel()
  }
</script>

<div class="relative flex flex-col items-center">
  {#if holding}
    <span
      class="absolute -top-11 whitespace-nowrap rounded-full bg-ink px-3 py-1.5 text-[10.5px] font-semibold text-white shadow-lg"
      >Keep holding…</span
    >
  {/if}

  <div class="relative grid h-[74px] w-[74px] place-items-center">
    <span class="pointer-events-none absolute h-[72px] w-[72px] rounded-full bg-sos/25 animate-sos-pulse"></span>
    <span
      class="pointer-events-none absolute h-[72px] w-[72px] rounded-full bg-sos/20 animate-sos-pulse"
      style="animation-delay: 1.2s"
    ></span>

    <button
      type="button"
      aria-label="Hold to send SOS alert"
      onpointerdown={begin}
      onpointerup={cancel}
      onpointerleave={cancel}
      onpointercancel={cancel}
      onkeydown={onkeydown}
      onkeyup={onkeyup}
      oncontextmenu={(event) => event.preventDefault()}
      class="group relative grid h-[70px] w-[70px] touch-none select-none place-items-center rounded-full bg-gradient-to-b from-[#FF5B50] to-[#DD2019] text-white ring-[5px] ring-white transition-transform duration-150 active:scale-95"
      style="box-shadow: 0 14px 30px -8px rgba(221, 32, 25, 0.65), inset 0 1px 0 rgba(255,255,255,0.35)"
    >
      <svg class="pointer-events-none absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="3.5" />
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke="#fff"
          stroke-width="3.5"
          stroke-linecap="round"
          stroke-dasharray={`${progress * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
        />
      </svg>
      <span class="relative flex flex-col items-center leading-none">
        <span class="text-[15px] font-bold tracking-tight">SOS</span>
        <span class="mt-0.5 text-[7.5px] font-semibold uppercase tracking-[0.12em] text-white/70"
          >hold</span
        >
      </span>
    </button>
  </div>
</div>
