// Helpers for HTTP 429 responses. The backend sends Retry-After (seconds)
// for auth endpoints; SOS 429s currently have no header, so callers pass a
// fallback or show the backend message.

/** Seconds to wait, or null when the server did not provide one. */
export function retrySeconds(err) {
  const value = Number(err?.retryAfter)
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : null
}

/** 900 -> "15:00"; 3661 -> "1:01:01". */
export function formatCooldown(totalSeconds) {
  const total = Math.max(0, Math.ceil(Number(totalSeconds) || 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`
}
