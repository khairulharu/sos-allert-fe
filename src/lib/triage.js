// Normalisation rules for the server-side triage payloads.
//
// The backend only produces a classification when it has an emergency type;
// `severity` is a real 0..1 score once the type exists (0 is Jev's lowest
// rubric level, not "no triage" — see docs/api-changes.md, #55). A silent clip
// still comes back with Go's zero values (`emergency_type: ""`, `severity: 0`)
// plus `transcription_status: "empty"` (#54), so the type — not the number — is
// the presence marker. The client never invents either value.

export const TRIAGE_TYPES = ['DANGER', 'MEDICAL', 'ACCIDENT']

function clampSeverity(value) {
  return Math.min(1, Math.max(0, value))
}

/**
 * One server triage payload → the object the UI is allowed to show, or null
 * when the payload is not a classification. Every field comes from this
 * payload: a missing value is never borrowed from an earlier alert.
 */
export function normalizeTriage(payload) {
  if (!payload) return null
  const type = TRIAGE_TYPES.includes(payload.emergency_type)
    ? payload.emergency_type
    : null
  if (!type) return null

  const severity = Number.isFinite(payload.severity)
    ? clampSeverity(payload.severity)
    : null
  return {
    emergency_type: type,
    severity,
    summary: payload.summary || '',
  }
}

/**
 * `AlertDetailResponse`/inbox/history carry `severity` only when the incident
 * was ever classified; the server still defaults `emergency_type` to DANGER, so
 * a missing score is the only way to tell "never classified" from a real
 * lowest-level danger.
 */
export function isClassifiedAlert(alert) {
  return Number.isFinite(alert?.severity)
}
