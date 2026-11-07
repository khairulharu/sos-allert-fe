// Microphone access, handled the same way the app handles geolocation:
// the permission is requested once up front (see App.svelte) so the SOS
// screen never dies on a first-time browser dialog, and the SOS audio
// section explains how to recover when the browser blocked the mic.
//
// Browsers only expose the microphone in a secure context (https:// or
// localhost) — on an insecure origin `navigator.mediaDevices` is not even
// defined — so that case is reported as such instead of looking like a user
// denial. `micBlockReason()` answers first, because it is the only check
// whose message the user can act on.

export const MIC_HELP = {
  denied:
    'Microphone blocked. Allow it for this site in your browser settings (padlock icon → Microphone → Allow), then try again.',
  insecure:
    'Recording needs a secure connection. Open the app over https:// or on a localhost address.',
  unsupported: 'This browser cannot record audio.',
  'no-device': 'No microphone was found on this device.',
  failed: 'Could not start recording.',
}

// 'insecure' | 'unsupported' | null
export function micBlockReason() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported'
  if (window.isSecureContext === false) return 'insecure'
  if (typeof navigator.mediaDevices?.getUserMedia !== 'function') return 'unsupported'
  if (typeof MediaRecorder === 'undefined') return 'unsupported'
  return null
}

// 'granted' | 'denied' | 'prompt' | 'unknown' | 'insecure' | 'unsupported'
export async function micPermissionState() {
  const blocked = micBlockReason()
  if (blocked) return blocked
  try {
    // Safari has no 'microphone' entry in the Permissions API → 'unknown'.
    const status = await navigator.permissions?.query({ name: 'microphone' })
    return status?.state || 'unknown'
  } catch {
    return 'unknown'
  }
}

// Opens the browser's permission prompt and immediately releases the device:
// we only want the grant, never a held-open microphone.
export async function requestMicAccess() {
  const blocked = micBlockReason()
  if (blocked) return { state: blocked }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((track) => track.stop())
    return { state: 'granted' }
  } catch (err) {
    if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
      return { state: 'denied' }
    }
    if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') {
      return { state: 'no-device' }
    }
    return { state: 'failed', message: err?.message }
  }
}

// Maps a getUserMedia failure to the copy the SOS screen shows.
export function micErrorText(err) {
  const blocked = micBlockReason()
  if (blocked) return MIC_HELP[blocked]
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') return MIC_HELP.denied
  if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') {
    return MIC_HELP['no-device']
  }
  return err?.message || MIC_HELP.failed
}
