// Shared formatting for SOS alert metadata (inbox, incoming sheet, banners).

const TYPE_LABELS = {
  DANGER: 'Danger',
  MEDICAL: 'Medical',
  ACCIDENT: 'Accident',
}

export function emergencyLabel(type) {
  return TYPE_LABELS[type] || 'SOS'
}

// Severity tiers. The fan-out radius is the backend's ladder (1/2/5 km), and the
// word under the severity bar must not disagree with the radius copy next to it
// (a 0.6 alert read "High" while the copy claimed the mid radius), so both sides
// of that card read this one table instead of hardcoding their own thresholds.
const SEVERITY_TIERS = [
  { min: 0.75, word: 'Critical', radiusM: 5000 },
  { min: 0.67, word: 'High', radiusM: 5000 },
  { min: 0.34, word: 'Medium', radiusM: 2000 },
  { min: 0, word: 'Low', radiusM: 1000 },
]

/**
 * The tier a severity sits in, or null when there is no number to judge.
 * `radiusM` is the fan-out radius the backend uses for that tier.
 */
export function severityTier(severity) {
  const value = Number(severity)
  if (severity === null || severity === undefined || !Number.isFinite(value)) return null
  const clamped = Math.min(1, Math.max(0, value))
  return SEVERITY_TIERS.find((tier) => clamped >= tier.min) || SEVERITY_TIERS.at(-1)
}

/**
 * Severity as a word. The raw 0–1 float is a backend value and reads as noise in
 * the UI ("severity 0.72"); the word is what a responder can act on.
 */
export function severityWord(severity) {
  return severityTier(severity)?.word || ''
}

/** Fan-out radius (metres) for this severity, or null when it has none. */
export function severityRadiusM(severity) {
  return severityTier(severity)?.radiusM ?? null
}

export function initialsFor(name) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('')
}

export function timeAgo(timestamp) {
  const value = Number(timestamp)
  if (!Number.isFinite(value)) return 'just now'
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  return `${Math.floor(seconds / 3600)} h ago`
}

export function formatDistance(meters) {
  if (!Number.isFinite(meters)) return ''
  if (meters < 100) return 'under 100 m'
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`
}

export function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`
  const minutes = Math.round(seconds / 60)
  return `${minutes} min`
}

/**
 * One-line summary for a responder en route, from a ResponderSummary or a
 * RESPONDER_ADDED frame: "240 m away · ETA 3 min · answered 2 min ago".
 * Distance and ETA are recorded when they answered, not live positions.
 */
export function responderMeta(person) {
  return [
    Number.isFinite(person?.distance_m) ? `${formatDistance(person.distance_m)} away` : '',
    person?.eta_seconds ? `ETA ${formatEta(person.eta_seconds)}` : '',
    Number.isFinite(person?.responded_at) ? `answered ${timeAgo(person.responded_at)}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Great-circle distance in metres between two {lat,lng} values. */
export function distanceMeters(a, b) {
  const lat1 = Number(a?.lat ?? a?.latitude)
  const lng1 = Number(a?.lng ?? a?.longitude)
  const lat2 = Number(b?.lat ?? b?.latitude)
  const lng2 = Number(b?.lng ?? b?.longitude)
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null

  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}
