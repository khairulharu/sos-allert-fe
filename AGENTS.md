# AGENTS.md — SOS Alert Frontend

Svelte 5 + Vite + Tailwind v4 mobile-first UI for the SOS Allert backend.
Companion backend: `../backend` (Go/Fiber, module `golang-clean-architecture`).
Backend state at handoff: commit `fb661d9` (browser Web Push: `webpush` config
section, `push_subscriptions` table, `/api/push/*` endpoints) on top of
`7e7ec3b` (X-Forwarded-For trust + locked CORS) and `dac6219` (location APIs,
auth rate limit, audio STT). The mirrored API contract matches `fb661d9`.

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

The backend locks CORS to `https://allert.my.id` and `http://localhost:5173`,
so reach the dev server at exactly `http://localhost:5173`. `http://127.0.0.1:5173`,
a LAN address (`npm run dev -- --host`), or `npm run preview` (port 4173) are
refused by preflight until they are added to the `AllowOrigins` list in
`../backend/internal/config/fiber.go`.

## Backend contract (authoritative)

- Full spec: `api/api-spec.json`
- Human summary: `api/api.md`
- Both files are mirrored from `../backend/api/`. The backend copy remains the
  source of truth; re-copy after backend API changes. The frontend copy exists
  so a session opened in this repo has the contract without leaving the
  workspace. Last re-copy: the pre-trigger classify endpoint
  (`POST /api/sos/classify`), the explicit `severity`/`summary` trigger fields,
  and the media response's `escalated`/`recipients_added`, at backend commit
  `2eca9b8`.
- Auth header: raw session token, **no `Bearer ` prefix**.
  `POST /api/users/_login` returns `data.token`.
- Success envelope: `{ "data": ... }`; contact list also has `{ "paging": ... }`.
- Error envelope: `{ "errors": "<message>" }` with the HTTP status.
- All timestamps are epoch milliseconds (`int64`).
- CORS is origin-locked to `https://allert.my.id` and `http://localhost:5173`
  (`AllowMethods` GET/POST/PUT/PATCH/DELETE/OPTIONS, `AllowHeaders` Origin,
  Content-Type, Accept, Authorization, X-Idempotency-Key, `AllowCredentials`
  false). Any other origin fails preflight, so the app must be served from one
  of those two origins. Only `Content-Disposition` is exposed (see rate-limit
  gap below).
- Protected routes: everything except `POST /api/users`,
  `POST /api/users/_login`, and `GET /metrics`.

## Current frontend state

- Live/wired: register/login/logout, current profile, location heartbeat,
  SOS trigger + AI triage card + resolve, alerts (active + inbox), emergency
  contacts list/create, Leaflet/OSM responder map
  (own heartbeat + `GET /api/location/nearby` polled every 15 s; masked pins
  and generic "Responder" rows, no names), sender-side WebSocket live tracking
  (`/ws/sos/:alertId/track?token=`; breadcrumbs every 5 s, live pin,
  `ALERT_STATUS`), HTTP 429 handling (auth cooldown/countdown, SOS limit
  screen), real incoming responder alerts (`GET /api/sos/inbox` polled every
  12 s, real sheet/banner, `POST /respond`, then responder WS stream),
  10 s audio evidence via `MediaRecorder` + multipart upload. **The SOS
  countdown is the audio window**: the 10 s between "Continue → Send SOS" and
  the trigger are recorded, the clip is classified before the alert goes out
  (`POST /api/sos/classify`, nothing persisted), and the audio-derived
  `emergency_type`/`severity`/`summary` ride in the `POST /api/sos` body — so the
  **first fan-out already uses the level from the speech**, not the typed
  description. The clip is then uploaded to `POST /api/sos/:alertId/media` as the
  evidence responders can listen to; if that transcript raises the severity, the
  backend widens the radius and the screen shows `escalated`/`recipients_added`.
  The active screen shows the transcript and follows re-classifications
  (`ALERT_TRIAGE` over the tracking socket does the same when it happens later),
  so the card starts as "from your description" — or as "from your audio" as soon
  as the pre-trigger classification lands — and a `503`/`502` from classify falls
  back to that description triage. A blocked microphone does not stop the SOS —
  the countdown says "Sending without audio" and the description triage stands.
  **Browser Web
  Push is wired**: the Profile toggle registers `/sw.js` + a VAPID subscription
  with `POST /api/push/subscriptions`, `App.svelte` re-syncs it on
  restore/login and drops it on sign-out/session-expired, and a nearby SOS
  shows a real OS notification (see "Browser Web Push" below). **Install icons
  are wired**: `public/manifest.webmanifest`, `public/apple-touch-icon.png`
  (180×180) and `public/icons/icon-192|512.png` carry the sign-in logo — the
  `--color-ink` tile, its `from-white/20` sheen, and the white `Siren` at 30/64
  — with `index.html` linking the manifest, the apple icon, and
  `apple-mobile-web-app-title` ("SOS Alert") for Add to Home Screen. The PNGs
  are full-bleed (iOS applies its own mask); `public/favicon.svg` is the same
  artwork with the tile's 22/64 rounding.
- Not wired yet:
  - false-alarm cancel (`POST /api/sos/:alertId/cancel` → `CANCELLED`): the
    backend needs a `safe_pin` the app never sets, so `PATCH /api/users/_current`
    (Profile) has to come first; today the only way to close an alert is
    `resolve` (`RESOLVED`);
  - video capture and in-app playback/download of media;
  - native push device tokens (FCM/APNs via `fcm_token`/`apns_token`) — browser
    Web Push covers the browser demo, and inbox polling stays as the in-app
    fallback.

## Important files

- `src/lib/api.js` — fetch wrapper, raw token, API base URL. Error objects carry
  `status`, `payload`, and `retryAfter` (parsed from `Retry-After` seconds or
  HTTP date). `request()` passes `FormData` through untouched (no JSON
  Content-Type) for multipart uploads; `sos.uploadMedia(alertId, blob, filename)`
  posts field `file` to `/api/sos/:id/media` and `sos.classify(blob, filename)`
  the same field to `/api/sos/classify` (pre-trigger classification, thrown
  errors carry `status` so the caller can fall back on `503`/`502`). The `push`
  module wraps the four Web Push routes (`publicKey`, `subscribe`, `unsubscribe`,
  `list`).
- `src/lib/push.js` — browser Web Push registration (mirrors the grant-only
  style of `mic.js`). `pushBlockReason()` reports `insecure`/`unsupported`
  first, `pushPermissionState()` maps `Notification.permission`, and
  `enablePush()` (prompt + `/sw.js` + `PushManager.subscribe()` + backend POST),
  `disablePush()` (backend DELETE + browser `unsubscribe()`), and
  `syncPushSubscription()` (silent re-register, only when already granted) do
  the work. A subscription created with a different VAPID key is replaced
  instead of reused. `PUSH_HELP` holds the user-facing copy.
- `public/sw.js` — the service worker Vite serves from the root: `push` →
  `showNotification` (`title`/`body`/`tag = alert_id`, `requireInteraction`,
  `data.url`), `notificationclick` → focus an existing window or
  `openWindow('/')`.
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
  The store also carries `triage` (`{emergency_type, severity, summary}`), set
  by the `ALERT_TRIAGE` frame the backend broadcasts after it re-classifies an
  alert from the transcribed audio; frames whose `alert_id` does not match the
  connected alert are ignored.
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
  first-time browser dialog never lands mid-SOS. Web Push is driven from the
  same hooks: `syncPushSubscription()` after `startNearbyPolling()` on restore
  and login, `await disablePush()` **before** the session teardown in
  `onSignOut()`/`onSessionExpired()` (the server DELETE needs a valid token),
  and `startInboxPolling()` registers the `visibilitychange` listener that polls
  the inbox immediately when the tab becomes visible again (clicking a push
  notification surfaces the incoming sheet without waiting a tick);
  `stopInboxPolling()` removes it again. `onSignOut()` ends with the store's
  `logout()`, which calls `DELETE /api/users` and clears the token + stored user,
  so signing out really revokes the session (previously it only reset the local
  flags and a reload logged the user straight back in).
- `src/lib/components/HomeView.svelte` — quick actions, nearby responders,
  recent activity. Location is read-only here: `own`, `responders`,
  `nearbyRadius`/`nearbyLoading`/`nearbyError` come from `$lib/geo.js`, and the
  pill under the greeting shows the reverse-geocoded heartbeat location
  (`Locating…` → `Kuta, Badung`, `Location unavailable` when the heartbeat or
  the geocoder has no answer) from the shared `place` store. It no longer owns
  a poller or geolocation call, and `App.svelte` keeps it mounted (hidden) so
  returning to Home reuses the same Leaflet map instead of rebuilding it.
- `src/lib/components/MapCard.svelte` — Leaflet + OpenStreetMap map (no
  token). Props: `own` (`GET /api/location` payload), `responders`
  (`nearby` items), `focus` (incoming alert location; centers the map and draws
  an amber pin), `live` (tracking store frame), `radiusM`, `height` (height
  class; Home passes `h-[300px]`, the incoming sheet `h-[132px]`),
  `showControls`, `showRadiusDefault`. Draws the radius circle (dashed
  `#FF3B30`, 1.5 px, stroke 0.55 / fill 0.11), blue own dot, generic masked
  responder pins, and a pulsing red pin that follows `LOCATION_UPDATE`; the
  live pin is removed on terminal status. A `ResizeObserver` re-measures the
  container (`map.invalidateSize()`) so the map survives being hidden and shown.
- `src/lib/components/AlertIncoming.svelte` — real inbox alert sheet. Receives
  one `AlertDetailResponse`, computes approximate distance from own coords to
  the masked location, and calls the app's respond handler. It also takes the
  responder's tracking store and the `responded` record: the sheet stays open
  after `POST /respond` as the responder's live view (ETA line, the victim's
  moving pin on the map) and prefers an `ALERT_TRIAGE` re-classification over the
  inbox payload, flagging it with a "Re-classified from the audio" chip. The app
  drops it once the alert reaches a terminal status.
- `src/lib/components/AlertFlow.svelte` — describe → 10 s countdown → classify →
  trigger → triage → resolve. The countdown is two things at once. It is the
  cancel window: the alert is only POSTed when it runs out, so "Cancel alert" and
  the header X abort locally with nothing to undo (they render only while
  `phase === 'count'`; `'sending'` is the in-flight spinner and offers no
  cancel). And it is the audio window: `startCapture()` opens the microphone as
  the countdown starts (`captureState`, shown as "Audio evidence recording · Ns
  left"), and the recorder is stopped the moment the countdown ends.
  `doTrigger()` then runs three steps: `sosApi.classify(clip)` (pre-trigger, so
  the first fan-out uses the audio level — a `503`/`502`/offline failure just
  sets `classifyError` and the SOS goes out on the description triage), the
  trigger with `emergency_type`/`severity`/`summary` when the classification
  succeeded, and finally the evidence upload to `POST /api/sos/:id/media` with
  the same clip. A blocked or failing microphone only downgrades the UI
  ("Sending without audio", `MIC_HELP` copy) and the SOS still goes out. The
  triage card starts as "from your description" — or "from your audio" as soon
  as the classify response lands — then `applyTriage()` takes over from the media
  response or an `ALERT_TRIAGE` frame; it shows the transcript, the
  transcription note (`disabled`/`too_large`/`empty`/`failed`) and, when the
  media response escalated the fan-out, "+N responders at the wider radius" with
  the notified count including them.
  Ending an active alert takes two taps — "I'm safe — end alert" arms
  `confirming`, the second tap sends `POST /resolve` — so a stray tap cannot
  stop a live alert. Starts tracking via `ontrack`, sends throttled breadcrumbs
  while active, shows the WS connection state, and ends on terminal
  `ALERT_STATUS`. The active view also keeps a manual evidence recorder on top
  of the automatic clip: `getUserMedia` + `MediaRecorder`, 10 s auto-stop,
  explicit stop, mime fallback (webm/opus → webm → mp4 → ogg), multipart upload
  through the same `uploadClip()`, and cleanup on unmount or terminal status
  (an in-flight clip is dropped when the alert ends). The audio section also
  reports the permission state before the user taps record: denied → how to
  re-allow the microphone, insecure origin → “needs a secure connection”
  (`$lib/mic.js`).
- `src/lib/components/AlertsView.svelte` — active + inbox merge/dedupe.
- `src/lib/components/ContactsView.svelte` — emergency contacts.
- `src/lib/components/ProfileView.svelte` — profile + settings toggles. The
  `push` toggle is real: state comes from `pushPermissionState()` on mount and
  the click handler calls `enablePush()`/`disablePush()`, showing `PUSH_HELP`
  copy in the row hint when it fails. The other toggles are still local state.

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

`POST /api/sos/classify` takes the same multipart `file` field before the alert
exists and returns `emergency_type`/`severity`/`summary` (+`transcript`,
`transcription_status`) without persisting anything. `AlertFlow` calls it with
the countdown clip and sends those three values in the trigger body, where they
win over the description triage and pick the adaptive radius — so the first
fan-out is already based on the speech. `503` (STT off), `502` (provider failed),
`400` and network errors just fall back to the description triage: the SOS goes
out either way, and the media upload then re-classifies from the same clip.

`src/lib/tracking.js` folds `ALERT_TRIAGE` into the `triage` field of the
tracking store; `AlertFlow` applies it to the triage card (header, severity bar
and radius copy all follow it) and `AlertIncoming` prefers it over the inbox
payload while the responder sheet is open.

Because the clip is uploaded as well (the classify endpoint stores nothing, and
the media row is what responders can listen to), the audio is transcribed twice:
once for the pre-trigger classification and once by the media endpoint. The
second pass is what can widen the fan-out — `UploadMedia` compares the alert's
pre-audio severity with the transcript triage, re-runs `findRecipients` at the
wider radius, notifies only the new responders after the grace period, and
reports `escalated`/`recipients_added`, which the active screen shows. If the
backend were to accept a "transcribe: false" hint on the media upload, the
frontend could drop the duplicate pass.

## Browser Web Push (implemented)

Push reaches the browser directly (VAPID, no Firebase credentials), so a nearby
SOS shows a real OS notification even while the tab is in the background.

- Config lives in the backend: `../backend/config.json` → `webpush.enabled`,
  `vapid_public_key`, `vapid_private_key`, `subscriber`, `ttl_seconds`. The
  private key never leaves the backend; the browser reads the public key from
  `GET /api/push/vapid-public-key` (`503` when the channel is off or the key
  pair is missing). `subscriber` is a bare email — the library adds `mailto:`.
- Flow: Profile → **Push notifications** toggle (a user gesture, the only place
  that opens the permission prompt) → `enablePush()` → `/sw.js` registered →
  `PushManager.subscribe({userVisibleOnly: true, applicationServerKey})` →
  `POST /api/push/subscriptions` with `{endpoint, p256dh, auth, user_agent}`.
- `endpoint` is unique in `push_subscriptions`, so toggling off/on (or
  re-subscribing from the same browser as another user) upserts one row instead
  of duplicating. Toggling off sends `DELETE /api/push/subscriptions` and then
  `subscription.unsubscribe()`, so the browser stops receiving alerts.
- Notification payload: `{title, body, data}` where `data` mirrors the FCM data
  map (`alert_id`, `sender_id`, `emergency_type`, `latitude`, `longitude`,
  optional `severity`/`summary`) plus `url: "/"`; `public/sw.js` renders it and
  a click focuses an open window (or opens `/`).
- `App.svelte` re-syncs silently on restore/login — `syncPushSubscription()`
  only runs when the permission is already granted, so a browser that never
  opened the toggle gets no unprompted dialog (its in-app inbox sheet still
  works). Sign-out and session-expired call `disablePush()` before the session
  teardown, because the server DELETE needs a valid token.
- Requires a secure context (`https://` or `localhost`); an `http://` LAN host
  reports `insecure` (`PUSH_HELP.insecure`) instead of failing silently.
- Backend caveat: web push only fires in the web process, so it needs
  `kafka.producer.enabled: false` (the worker passes `nil` — it has no DB).
  The current dev `config.json` satisfies this.
- Verified live: Chrome at `localhost:5173` created a real
  `https://fcm.googleapis.com/fcm/send/...` subscription through the toggle, and
  an SOS triggered by a second user delivered the encrypted push through FCM into
  `sw.js` (`showNotification` with the triage body and `tag = alert_id`).

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

- Dev DB migrations are at `20261109000000_push_subscriptions`; other
  environments need `migrate up` (see `../backend/README.md`).
- Nearby respond coords are masked; do not expect exact positions.
- Native FCM/APNs device push and Twilio SMS are log-only (no credentials);
  **browser Web Push is configured and live** instead (see "Browser Web Push").
- Re-fanout is implemented: when a post-trigger clip raises the severity, the
  backend widens the radius and notifies only the new responders, and the media
  response reports `escalated`/`recipients_added`. Pending backend items: native
  push/SMS credentials and Redis GEO TTL/cleanup.
- Incoming-alert semantics: `GET /api/sos/inbox` is the in-app fallback for push
  (it also feeds the sheet when Web Push is off/denied). WS tracking is per-alert
  and only authorizes the sender or a recorded responder, so the app polls the
  inbox first and connects to WS after `POST /respond`. Inbox coords are masked
  (`masked: true`) until the user responds, so the sheet's distance is
  approximate.
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
