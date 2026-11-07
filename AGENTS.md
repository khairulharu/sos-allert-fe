# AGENTS.md — SOS Alert Frontend

Svelte 5 + Vite + Tailwind v4 mobile-first UI for the SOS Allert backend.
Companion backend: `../backend` (Go/Fiber, module `golang-clean-architecture`).
Backend state at handoff: commit `dac6219` (location APIs, auth rate limit, audio STT).
The mirrored API contract is at frontend commit `6cd9ea0`.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build
```

`VITE_API_URL` defaults to `http://localhost:3000`; override via `.env`
(see `.env.example`). Backend must be running separately:

```bash
cd ../backend && go run cmd/web/main.go
```

## Backend contract (authoritative)

- Full spec: `api/api-spec.json`
- Human summary: `api/api.md`
- Both files are mirrored from `../backend/api/` at backend commit `dac6219`
  (frontend commit `6cd9ea0`). The backend copy remains the source of truth;
  re-copy after backend API changes. The frontend copy exists so a session
  opened in this repo has the contract without leaving the workspace.
- Auth header: raw session token, **no `Bearer ` prefix**.
  `POST /api/users/_login` returns `data.token`.
- Success envelope: `{ "data": ... }`; contact list also has `{ "paging": ... }`.
- Error envelope: `{ "errors": "<message>" }` with the HTTP status.
- All timestamps are epoch milliseconds (`int64`).
- CORS allows any origin (`AllowOrigins: "*"`) with `Authorization` and
  `X-Idempotency-Key`; only `Content-Disposition` is exposed (see rate-limit
  gap below).
- Protected routes: everything except `POST /api/users`,
  `POST /api/users/_login`, and `GET /metrics`.

## Current frontend state

- Live/wired: register/login/logout, current profile, location heartbeat,
  SOS trigger + AI triage card + resolve, alerts (active + inbox), cancel
  with Safe PIN, emergency contacts list/create, Leaflet/OSM responder map
  (own heartbeat + `GET /api/location/nearby` polled every 15 s; masked pins
  and generic "Responder" rows, no names), sender-side WebSocket live tracking
  (`/ws/sos/:alertId/track?token=`; breadcrumbs every 5 s, live pin,
  `ALERT_STATUS`), HTTP 429 handling (auth cooldown/countdown, SOS limit
  screen), real incoming responder alerts (`GET /api/sos/inbox` polled every
  12 s, real sheet/banner, `POST /respond`, then responder WS stream),
  10 s audio evidence via `MediaRecorder` + multipart upload. The backend now
  transcribes audio (≤ 25 MB) and returns `transcript`, `transcription_status`,
  and updated `triage`; the UI does not display those fields yet.
- Not wired yet:
  - handling the new `ALERT_TRIAGE` WebSocket frame and showing the updated
    classification/transcript in the active alert and responder sheet;
  - video capture and in-app playback/download of media;
  - native push (FCM/APNs) — inbox polling is the browser fallback.

## Important files

- `src/lib/api.js` — fetch wrapper, raw token, API base URL. Error objects carry
  `status`, `payload`, and `retryAfter` (parsed from `Retry-After` seconds or
  HTTP date). `request()` passes `FormData` through untouched (no JSON
  Content-Type) for multipart uploads; `sos.uploadMedia(alertId, blob, filename)`
  posts field `file` to `/api/sos/:id/media`.
- `src/lib/rateLimit.js` — `retrySeconds(err)` + `formatCooldown(seconds)` shared
  by the auth and SOS 429 UIs.
- `src/lib/place.js` — reverse geocoding for the header location pill
  (Nominatim/OSM, no API key; same source as the map tiles). Coordinates are
  bucketed to 3 decimals (~110 m), answers cached in localStorage for 7 days
  and deduped per bucket, so a wandering heartbeat does not re-ask the
  provider. `resolvePlace()` returns `"Kuta, Badung"`-style labels or `null`.
- `src/lib/geo.js` — session-scoped location state, owned once rather than per
  view: `own` (`GET /api/location` heartbeat), `responders`, `nearbyRadius`,
  `nearbyLoading`, `nearbyError`. `startNearbyPolling({ onSessionExpired })` /
  `stopNearbyPolling()` mirror the inbox poller and are driven by `App.svelte`
  on restore/login and logout/`401`. `refreshNearby()` reads the stored
  heartbeat (`404` → publishes one browser fix, then re-reads) and calls
  `location.nearby(1000)`; concurrent callers share one in-flight request.
  `browserPosition()` is the app's only geolocation call site: it caches the
  last fix for 45 s, dedupes concurrent askers, and falls back to the last known
  fix when a new acquisition fails. It also subscribes to `own` and publishes
  the reverse-geocoded label into the `place` store (src/lib/place.js), without
  blanking a known label when `own` is transiently empty.
- `src/lib/mic.js` — microphone permission, handled like the location prompt.
  `micBlockReason()` answers first (`insecure` when `isSecureContext` is false,
  where `navigator.mediaDevices` does not even exist, else `unsupported`), then
  `micPermissionState()` / `requestMicAccess()` (grant-only: the stream is
  stopped immediately) and `micErrorText()` for the copy shown in the SOS flow.
- `src/lib/tracking.js` — two independent WebSocket channels sharing one
  connection implementation. Builds the WS URL (`VITE_WS_URL` or `ws(s)://`
  derived from `VITE_API_URL`), sends the raw token as `?token=`, reconnects
  with exponential backoff, queues breadcrumbs while connecting, and stops on
  terminal `ALERT_STATUS` or an `{error}` frame.
  Sender: `tracking`, `startTracking(alertId, seed)`, `stopTracking()`,
  `sendBreadcrumb(fields)`. Responder (read-only): `responderTracking`,
  `startResponderTracking(alertId, seed)`, `stopResponderTracking()`.
  **Pending:** handle the new `ALERT_TRIAGE` frame (emergency_type, severity,
  summary) published after audio transcription.
- `src/lib/alertMeta.js` — `emergencyLabel`, `initialsFor`, `timeAgo`,
  `formatDistance`, `formatEta`, and `distanceMeters` (haversine) shared by the
  incoming sheet and Home banner.
- `src/lib/stores.js` — session store. **Do not regress** `restoreSession()`:
  it must use `getToken()` (localStorage key `sos_alert_token`), never
  `user.id`. Using `user.id` caused every authenticated call after login to
  return 401 (fixed in commit `97dc741`).
- `src/App.svelte` — auth gate, geolocation heartbeat every 60 s, toast, and
  WS/inbox orchestration. On restore/login it calls `GET /api/sos/active` once
  and starts tracking the user's active alert; trigger passes the new id through
  `ontrack`. It also polls `GET /api/sos/inbox` every 12 s: alerts already
  present on the first poll show as a banner, new alerts auto-open the sheet,
  and dismissing records the id so it is not shown again. `POST /respond` uses
  browser coords → stored heartbeat → fallback; success starts the responder
  WS channel and shows ETA/distance. Terminal statuses raise a toast.
  Fallback coords are Bali (`-8.65, 115.22`) if browser geolocation is denied;
  heartbeat errors are currently swallowed. The heartbeat awaits
  `browserPosition()` (`$lib/geo.js`, shared with the map) before each `PUT`, so
  the two writers can never publish different coordinates. It also starts/stops
  `startNearbyPolling()`/`stopNearbyPolling()` with the session, and keeps
  `HomeView` mounted (hidden) so tab switches do not rebuild the map or re-run
  the location flow. The microphone permission is primed once per session
  (`primeMicrophone` → `$lib/mic.js`) next to the location request, so a
  first-time browser dialog never lands mid-SOS.
- `src/lib/components/HomeView.svelte` — protection card, responder count,
  quick actions. Location is read-only here: `own`, `responders`,
  `nearbyRadius`/`nearbyLoading`/`nearbyError` come from `$lib/geo.js`, and the
  pill under the greeting shows the reverse-geocoded heartbeat location
  (`Locating…` → `Kuta, Badung`, `Location unavailable` when the heartbeat or
  the geocoder has no answer) from the shared `place` store. It no longer owns
  a poller or geolocation call, and `App.svelte` keeps it mounted (hidden) so
  returning to Home reuses the same Leaflet map instead of rebuilding it.
- `src/lib/components/MapCard.svelte` — Leaflet + OpenStreetMap map (no
  token). Props: `own` (`GET /api/location` payload), `responders`
  (`nearby` items), `focus` (incoming alert location; centers the map and draws
  an amber pin), `live` (tracking store frame), `radiusM`, `showControls`,
  `showRadiusDefault`. Draws the radius circle, blue own dot, generic masked
  responder pins, and a pulsing red pin that follows `LOCATION_UPDATE`; the
  live pin is removed on terminal status. A `ResizeObserver` re-measures the
  container (`map.invalidateSize()`) so the map survives being hidden and shown.
- `src/lib/components/AlertIncoming.svelte` — real inbox alert sheet. Receives
  one `AlertDetailResponse`, computes approximate distance from own coords to
  the masked location, and calls the app's respond handler. No demo copy.
- `src/lib/components/AlertFlow.svelte` — describe → 5 s countdown → trigger →
  triage → resolve. Starts tracking via `ontrack`, sends throttled breadcrumbs
  while active, shows the WS connection state, and ends on terminal
  `ALERT_STATUS`. Active view also owns audio evidence: `getUserMedia` +
  `MediaRecorder`, 10 s auto-stop, explicit stop, mime fallback
  (webm/opus → webm → mp4 → ogg), multipart upload, and cleanup on unmount or
  terminal status. The upload response now includes `transcript`,
  `transcription_status`, and `triage`; surface them in the active view when
  the STT backend is enabled. The audio section also reports the permission
  state before the user taps record: denied → how to re-allow the microphone,
  insecure origin → “needs a secure connection” (`$lib/mic.js`).
- `src/lib/components/AlertsView.svelte` — active + inbox merge/dedupe.
- `src/lib/components/ContactsView.svelte` — emergency contacts.
- `src/lib/components/ProfileView.svelte` — profile + settings toggles.

## Location API for the responder map

Implemented in `src/lib/api.js`:

```js
export const location = {
  update: (latitude, longitude) =>
    request('PUT', '/api/location', { latitude, longitude }),
  get: () => request('GET', '/api/location'),
  nearby: (radiusM = 1000) =>
    request('GET', `/api/location/nearby?radius_m=${encodeURIComponent(radiusM)}`),
}
```

- `PUT /api/location` — heartbeat `{latitude, longitude}`; also upserts one
  MySQL history row. Call at least every 2 minutes (App.svelte does 60 s).
- `GET /api/location` — own last heartbeat:
  `{ user_id, latitude, longitude, last_seen, stale }`; `404` if never sent.
- `GET /api/location/nearby?radius_m=1000` — responders around the caller.
  - `radius_m`: 100–5000, default 1000; invalid → `400`.
  - Requires the caller to have a heartbeat; otherwise `404`.
  - Excludes the caller and users with `last_seen` older than 2 minutes.
  - Capped at 50, nearest first.
  - Coordinates are rounded to 3 decimals (~100 m); `masked: true`.
  - Response:

```json
{
  "data": {
    "radius_m": 1000,
    "count": 1,
    "masked": true,
    "responders": [
      {
        "user_id": "user-b",
        "latitude": -6.21,
        "longitude": 106.848,
        "distance_m": 262,
        "last_seen": 1730304000000
      }
    ]
  }
}
```

No names/initials are returned — only `user_id`. Derive generic pins or add a
backend name lookup later (privacy decision).

## Responder map (implemented)

1. `location.get()` + `location.nearby()` live in `api.js`.
2. `geo.refreshNearby()` reads the stored heartbeat. If `GET /api/location` is
   `404`, it publishes one browser fix with `PUT` and retries `GET`; it never
   blocks the view on geolocation, and a failing fix falls back to the last
   known one.
3. `geo.startNearbyPolling()` polls `nearby(1000)` every 15 s, skipping ticks
   while the tab is hidden and refreshing immediately when the tab becomes
   visible again. Pins and the list update reactively from the `geo` stores.
4. `MapCard.svelte` is Leaflet + OSM, centered on own coords (or `focus` for
   an incoming alert), with radius circle, recenter, and radius toggle controls.
   It keeps the `max-w-[430px]` shell and existing card styling.
5. `401` from location APIs stops the poller and invokes the session-expired
   handler → `logout()` in `App.svelte`, returning to the auth screen.

Switching tabs must not re-run the location flow: `HomeView` stays mounted
(`hidden`) and reads the `geo` stores, and `App.svelte` owns the polling for the
session, so a round of tab switches issues no `/api/location*` request and asks
for no new geolocation fix.

Remaining map work: backend name lookup (privacy decision) for friendly labels
and a fullscreen/responder-detail view.

## Audio STT contract (backend, implemented)

The backend transcribes uploaded audio with a Groq/OpenAI-compatible
Whisper endpoint (default Groq `whisper-large-v3-turbo`, language `id`).

- API key location: `../backend/config.json` → `ai.stt.api_key`
  (`gsk_...`). It is **backend-only**; never put it in `.env`, localStorage,
  or any frontend code. Set `ai.stt.enabled: true` too.
- Frontend already uploads one assembled `Blob` as multipart field `file` to
  `POST /api/sos/:alertId/media`; the 20 `MediaRecorder` chunks are client-side
  only and must stay assembled into one file.
- Audio ≤ 25 MB is transcribed. Larger audio is stored with
  `transcription_status: "too_large"` and is not sent to the provider.
- Upload response (`data`) now includes:
  - `transcript` — speech-to-text result (omitted when empty);
  - `transcription_status` — `disabled | too_large | completed | empty | failed`;
  - `transcribed_at` — epoch ms;
  - `triage` — `{ emergency_type, severity, summary }` when the transcript
    changed the alert classification.
- STT/triage failures are fail-open: upload still returns `200`, media is
  stored, and the alert keeps its previous classification.
- The backend updates `alerts.emergency_type/severity/summary` and broadcasts
  on the tracking WebSocket:

```json
{
  "type": "ALERT_TRIAGE",
  "alert_id": "alt_...",
  "emergency_type": "MEDICAL",
  "severity": 0.8,
  "summary": "PRIORITAS TINGGI: Kemungkinan darurat medis",
  "updated_at": 1730304075000
}
```

`src/lib/tracking.js` does not handle `ALERT_TRIAGE` yet — add it to the
message switch and surface the new classification in the active alert and
responder sheet.

## Live tracking protocol notes

- WS URL: `ws(s)://<ws-base>/ws/sos/:alertId/track?token=<raw token>`; no
  `Bearer` prefix. `tracking.js` uses `VITE_WS_URL` or derives the base from
  `VITE_API_URL`.
- The server sends no initial snapshot: seed from the trigger response or
  `GET /api/sos/active` (App does this once, no polling), then apply frames.
- Only the sender sends breadcrumb JSON. Responders are subscribe-only; their
  sends are rejected by the backend and echoed as `{error}`.
- Frames: `{type:"LOCATION_UPDATE",latitude,longitude,speed_mps?,heading_deg?}`,
  `{type:"ALERT_STATUS",status,updated_at}`, and
  `{type:"ALERT_TRIAGE",emergency_type,severity,summary,updated_at}`.
- `RESOLVED`, `CANCELLED`, and `EXPIRED` are terminal: stop reconnecting and
  remove the live pin. `EXPIRED` is not currently broadcast by the backend
  scheduler, so treat a closed socket as reconnectable until status arrives.
- Reconnect uses exponential backoff (1/2/4/8/15 s); an `{error}` frame is
  fatal (no reconnect) because it means auth/authorization failed.

## Backend notes / known gaps

- Dev DB migrations are at `20261108000000_alert_media_transcription`; other
  environments need `migrate up` (see `../backend/README.md`).
- Nearby respond coords are masked; do not expect exact positions.
- FCM/APNs/Twilio credentials are not configured, so push is log-only.
- Pending backend items: push credentials, Redis GEO TTL/cleanup, and broader
  re-fanout when post-trigger audio raises severity. Audio STT itself is wired.
- Incoming-alert semantics: `GET /api/sos/inbox` is the browser substitute for
  push (FCM/APNs is log-only). WS tracking is per-alert and only authorizes the
  sender or a recorded responder, so the app polls the inbox first and connects
  to WS after `POST /respond`. Inbox coords are masked (`masked: true`) until
  the user responds, so the sheet's distance is approximate.
- `alert_responses` has no unique `(alert_id, responder_id)` constraint; the UI
  guards double submits and filters already-responded alerts out of the
  incoming list (`masked !== true` means participant).
- Rate-limit gap: CORS currently exposes only `Content-Disposition`, so
  cross-origin JS cannot read `Retry-After`. The auth UI falls back to the
  documented 15-minute lockout; adding `Retry-After` to `ExposeHeaders` makes
  the exact countdown work (tested with the header exposed). SOS 429s have no
  `Retry-After` at all, so the UI shows the backend message and hides "Try
  again".
- `backend/config.json` and `ca.pem` are gitignored; never commit them here.

## Verification

No frontend test suite. Run `npm run build` and verify the actual UI in a
browser at `http://localhost:5173` with the backend running.
