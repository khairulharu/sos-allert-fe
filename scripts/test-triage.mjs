// Regression test for the triage normalisation rules (#23, #54, #55).
//
// The backend only produces a classification when it has an emergency type:
//   - a silent clip is `{emergency_type:"", severity:0, transcription_status:"empty"}`
//     and must never become DANGER/Low in the UI (#54),
//   - `severity: 0` is a real lowest score once a type exists (#55),
//   - nothing may be borrowed from an earlier payload (#23).
//
// Run: npm run test:triage   (no browser needed)

import assert from 'node:assert/strict'
import { normalizeTriage, isClassifiedAlert, TRIAGE_TYPES } from '../src/lib/triage.js'

// 1. A silent/no-signal classify answer is not a classification, even though
// Go serialises severity as 0.
assert.equal(
  normalizeTriage({ emergency_type: '', severity: 0, transcription_status: 'empty' }),
  null,
  'a silent clip must not produce a classification',
)
console.log('ok 1 - empty type + severity 0 stays unclassified')

// 2. Missing payloads are no-ops.
assert.equal(normalizeTriage(undefined), null)
assert.equal(normalizeTriage(null), null)
assert.equal(normalizeTriage({}), null)
console.log('ok 2 - absent/empty payloads normalise to null')

// 3. Severity 0 with a real type is the lowest legitimate score, not "none".
assert.deepEqual(normalizeTriage({ emergency_type: 'DANGER', severity: 0 }), {
  emergency_type: 'DANGER',
  severity: 0,
  summary: '',
})
console.log('ok 3 - severity 0 with a type is preserved')

// 4. A normal classification is passed through unchanged.
assert.deepEqual(
  normalizeTriage({ emergency_type: 'MEDICAL', severity: 0.8, summary: 'Kemungkinan darurat medis' }),
  { emergency_type: 'MEDICAL', severity: 0.8, summary: 'Kemungkinan darurat medis' },
)
console.log('ok 4 - a normal triage payload is preserved')

// 5. Unknown enums are not trusted, so a future value cannot leak into the UI.
assert.equal(normalizeTriage({ emergency_type: 'FIRE', severity: 0.9 }), null)
console.log('ok 5 - unknown emergency types are rejected')

// 6. Severity is clamped to 0..1 and non-numbers are not invented.
assert.equal(normalizeTriage({ emergency_type: 'MEDICAL', severity: 1.4 }).severity, 1)
assert.equal(normalizeTriage({ emergency_type: 'MEDICAL', severity: -0.2 }).severity, 0)
assert.equal(normalizeTriage({ emergency_type: 'MEDICAL', severity: '0.8' }).severity, null)
console.log('ok 6 - severity is clamped, never parsed from a string')

// 7. Each payload is a snapshot: a second, signalless payload cannot inherit
// the type/severity of the first.
const first = normalizeTriage({ emergency_type: 'ACCIDENT', severity: 0.9, summary: 'Kecelakaan' })
const second = normalizeTriage({ emergency_type: '', severity: 0, transcription_status: 'empty' })
assert.equal(first.emergency_type, 'ACCIDENT')
assert.equal(second, null, 'the previous classification must not survive the new payload')
console.log('ok 7 - payloads do not inherit from each other')

// 8. Detail/inbox history: absent severity = never classified, 0 = a real score.
assert.equal(isClassifiedAlert({ emergency_type: 'DANGER' }), false)
assert.equal(isClassifiedAlert({ emergency_type: 'DANGER', severity: 0 }), true)
console.log('ok 8 - detail severity absence is the classified marker')

assert.deepEqual(TRIAGE_TYPES, ['DANGER', 'MEDICAL', 'ACCIDENT'])
console.log('\nAll triage normalisation checks passed.')
