# AGENTS.md — SOS Alert Frontend

Svelte 5 + Vite + Tailwind v4 mobile-first UI for the SOS Allert backend.
Companion backend: `../backend` (Go/Fiber, module `golang-clean-architecture`).
Backend state at handoff: commit `2eca9b8` (audio-driven triage: pre-trigger
`POST /api/sos/classify`, explicit trigger `severity`/`summary`, escalation
re-fanout) on top of `fd080bb` (that feature), `fb661d9` (browser Web Push),
`7e7ec3b` (X-Forwarded-For trust + locked CORS) and `dac6219` (location APIs,
auth rate limit, audio STT). The mirrored API contract matches `2eca9b8`.

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

### Production

`https://allert.my.id` serves the built output (`dist/`), so a deploy is
`git pull && npm run build` on the server. `VITE_API_URL` and `VITE_WS_URL` are
compiled into the bundle (the live one carries `https://api.allert.my.id` and
`wss://api.allert.my.id`), which means building without them silently points the
site at `http://localhost:3000`. `index.html` is served `no-cache` and the assets
are hashed, so a rebuild only needs a reload, and `public/sw.js` (push depends on
it) is served from the root with no fetch handler — there is no stale app shell
to clear.

Check which build is live by grepping the served bundle, e.g. for a string from
the newest commit:

```bash
curl -s https://allert.my.id/assets/index-*.js | grep -c "from your audio"
```

## Backend contract (authoritative)

- Full spec: `api/api-spec.json`
- Human summary: `api/api.md`
- Both files are mirrored from `../backend/api/`. The backend copy remains the
  source of truth; re-copy after backend API changes. The frontend copy exists
  so a session opened in this repo has the contract without leaving the
  workspace. Last re-copy: pentest fixes F-1/F-2/F-3/F-4 — `nearby`
  `distance_m` rounded to a 100 m bucket (`NearbyResponder.distance_m`) and the
  participant gate on `GET /api/sos/{alertId}`, `.../acknowledge`, `.../respond`
  (`404`/`403` for non-participants, `AlertDetailResponse.responders[]` only for
  participants) from backend `204419c`. Previous re-copy:
  alert history + summary (`GET /api/sos/history` with `SearchAlertHistory`
  query params and `paging`, `GET /api/sos/summary`, `AlertStatusCounts`,
  `AlertRespondedCounts`, `AlertSummaryResponse`) from backend `ef73bec` plus
  the uncommitted alert-history working tree. Previous re-copy: the responder
  list (`AlertDetailResponse.responders`, `ResponderSummary`) and the
  `RESPONDER_ADDED` frame at `6824363`.
- Handoff backend (perubahan kontrak dan yang belum diimplementasi):
  `docs/api-changes.md`, mirror dari `../backend/docs/api-changes.md` — jangan
  diedit di repo ini. Bagian "Media insiden (audio/video)" mencatat endpoint
  media yang sudah siap dipakai responder (`GET /api/sos/{alertId}/media`,
  `GET /api/sos/{alertId}/media/{mediaId}`) beserta gotcha-nya: endpoint butuh
  header `Authorization` (tidak bisa langsung jadi `<audio src>`), tidak ada
  event WS `MEDIA_ADDED`, `AlertDetailResponse` tidak memuat media, dan akses
  dibatasi sender + responder yang sudah `POST .../respond`. Player media untuk
  responder sudah diimplementasi (`src/lib/components/AlertMedia.svelte`, lihat
  bagian "Important files").
- Auth header: raw session token, **no `Bearer ` prefix**.
  `POST /api/users/_login` returns `data.token`.
- Success envelope: `{ "data": ... }`; contact list and alert history also have
  `{ "paging": ... }`.
- Error envelope: `{ "errors": "<message>" }` with the HTTP status.
- All timestamps are epoch milliseconds (`int64`).
- CORS is origin-locked to `https://allert.my.id` and `http://localhost:5173`
  (`AllowMethods` GET/POST/PUT/PATCH/DELETE/OPTIONS, `AllowHeaders` Origin,
  Content-Type, Accept, Authorization, X-Idempotency-Key, `AllowCredentials`
  false). Any other origin fails preflight, so the app must be served from one
  of those two origins. Only `Content-Disposition` is exposed (see rate-limit
  gap below).
- Protected routes: everything except `POST /api/users` and
  `POST /api/users/_login`. `GET /metrics` is registered only when
  `metrics.token` is set and requires that token in `Authorization`
  (`Bearer <token>` accepted); otherwise it returns `401`, and `404` when no
  token is configured.

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
  On the other side of that clip, the responder sheet now actually plays it
  (`AlertMedia.svelte`: `GET /api/sos/:id/media` polled, the stream fetched with
  the token into an object URL, transcript alongside — see "Important files").
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
  - video capture, video/audio download, dan playback media di luar sheet
    responder (`GET /api/sos/{alertId}/media` sudah terbaca, tapi hanya
    `AlertMedia.svelte` yang memakainya — sender masih sekadar melihat receipt);
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
  `list`). `sos.history({role,status,page,size})` goes through the `requestPaged`
  helper because `request()` returns only `payload.data` and would drop
  `paging`; `sos.summary()` wraps `GET /api/sos/summary`. `sos.listMedia(alertId)`
  reads `GET /api/sos/:id/media` and `sos.mediaBlob(alertId, mediaId)` returns a
  Blob for the stream endpoint — it goes through `requestBlob()` because the
  route needs the raw `Authorization` header and cannot be an `<audio src>`;
  errors still carry `status` (`403` non-participant, `404`, `412` storage).
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
  `data.url`), `notificationclick` → focus an existing window (messaging it
  `{type:'sos-alert', alert_id}`) or `openWindow('/?alert=<id>')`, so the app can
  open that alert's sheet instead of only a banner.
- `src/lib/rateLimit.js` — `retrySeconds(err)` + `formatCooldown(seconds)` shared
  by the auth and SOS 429 UIs.
- `src/lib/place.js` — reverse geocoding for the header location pill
  (Nominatim/OSM, no API key; same source as the map tiles). Coordinates are
  bucketed to 3 decimals (~110 m), answers cached in localStorage for 7 days
  and deduped per bucket, so a wandering heartbeat does not re-ask the
  provider. `resolvePlace()` returns `"Kuta, Badung"`-style labels or `null`.
- `src/lib/geo.js` — session-scoped location state, owned once rather than per
  view: `own` (`GET /api/location` heartbeat), `liveFix` (newest browser fix),
  `responders`, `nearbyRadius`, `nearbyLoading`, `nearbyReady`, `nearbyError`.
  `startNearbyPolling({ onSessionExpired })` / `stopNearbyPolling()` mirror the
  inbox poller and are driven by `App.svelte` on restore/login and logout/`401`.
  `refreshNearby()` reads the stored heartbeat (`404` → publishes one browser
  fix, then re-reads) and calls `location.nearby(<requested radius>)` (1 km by
  default); concurrent callers share one in-flight request **per radius**. The
  radius is snapshotted when a read starts and an answer only writes state while
  its own radius is still `$nearbyRadius`, so a slow 1 km response can never
  overwrite a 5 km choice (issue #5) — never reinstate the global
  `if (inFlight) return inFlight` guard or let a response call
  `nearbyRadius.set()`. `refreshNearbyNow()`
  (`App.svelte` calls it after every successful heartbeat `PUT`, so the count
  does not trail the poll by 15 s) and `setNearbyRadius(meters)` (Home's radius
  control; 100–`NEARBY_RADIUS_MAX_M` = 5000, re-searches immediately, and has no
  "already this radius" early return because a tap that lost a race could then
  be a silent no-op) are the
  only writers of the radius. `nearbyError` carries the reason the list is
  empty (`Location not shared yet` for a `404`, the fetch message otherwise) and
  `nearbyReady` marks that an answer has arrived — the header uses both so an
  empty list, a missing heartbeat and a failed request are three different
  claims. `startPositionWatch()`/`stopPositionWatch()` own
  the app's only `watchPosition` (`enableHighAccuracy`, `maximumAge: 0`), so a
  session streams fixes instead of asking once a minute; `liveFix` carries
  `{latitude, longitude, accuracy, speed, heading, at}`. `browserPosition()`
  returns the newest fix younger than 2 minutes, dedupes concurrent askers, and
  otherwise acquires one — it never returns a stale fix as current. `accuracy`
  (metres) draws the map's uncertainty circle and rides the SOS trigger as
  `accuracy_meters`; a browser without GPS reports its WiFi/IP position, which
  no web API can force to GPS. It also subscribes to `own` and publishes
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
  alert from the transcribed audio, and `responders` — appended from
  `RESPONDER_ADDED` (`responder_id`, optional `name`, `distance_m`,
  `eta_seconds`, `responded_at`), deduped per responder, so an open alert view
  learns who is on the way without waiting for the next inbox poll. Frames whose
  `alert_id` does not match the connected alert are ignored.
- `src/lib/alertMeta.js` — `emergencyLabel`, `initialsFor`, `timeAgo`,
  `formatDistance`, `formatEta`, `responderMeta` (one "240 m away · ETA 3 min ·
  answered 2 min ago" line from a `ResponderSummary`/`RESPONDER_ADDED` payload),
  and `distanceMeters` (haversine) shared by the incoming sheet, Home banner and
  the SOS screen.
- `src/lib/focus.js` — `trap(node, { initial })`, the Svelte action both
  full-screen dialogs use (`AlertFlow`, `AlertIncoming`). On mount it focuses the
  first `[data-autofocus]` (or first visible focusable) inside the node, wraps
  Tab/Shift-Tab inside the panel, and restores the previously focused element on
  destroy. `App.svelte` sets `inert` on `<main>` and the bottom nav while a sheet
  is open (`modalOpen = sosOpen || (incomingOpen && pendingAlert)`), so nothing
  behind the overlay is reachable. Any new modal needs both halves: `use:trap`
  on the panel and inclusion in `modalOpen`.
- `src/lib/stores.js` — session store. **Do not regress** `restoreSession()`:
  it must use `getToken()` (localStorage key `sos_alert_token`), never
  `user.id`. Using `user.id` caused every authenticated call after login to
  return 401 (fixed in commit `97dc741`).
  `locationSharing` (localStorage key `sos_alert_location_sharing`, default on)
  is the Profile "Live location" switch: `App.svelte`'s heartbeat skips the `PUT`
  while it is off and publishes once when it is turned back on, so the privacy
  control is real. `lastTriage` holds the newest AI triage for the alert flow.
  `logout()` must revoke **the session this tab owns** — it reads
  `getSessionToken()` (the in-memory token, never the shared localStorage) and
  passes it to `auth.logout(token)`. The backend keeps a single token per user
  row (`users.token`, rotated on every login, cleared on logout), so an account
  has exactly one live session: re-reading localStorage after an `await` can
  pick up the token another tab just logged in with and delete that fresh
  session instead. A tab that already ended its session must not run its
  sign-out again (see `onSessionExpired` in `App.svelte`).
- `src/lib/components/AuthScreen.svelte` — sign in / create account. `submit()`
  is guarded by `busy`: a double submit would rotate the account token twice and
  leave this client holding a token the server no longer accepts. The optional
  `notice` prop shows why the user landed back here (e.g. an expired session).
- `src/App.svelte` — auth gate, geolocation heartbeat every 60 s, toast, and
  WS/inbox orchestration. On restore/login it calls `GET /api/sos/active` once
  and starts tracking the user's active alert; trigger passes the new id through
  `ontrack`. It also polls `GET /api/sos/inbox` every 12 s: alerts already
  present on the first poll show as a banner, new alerts auto-open the sheet,
  and dismissing records the id so it is not shown again. A tapped push
  notification names its alert (`?alert=<id>` on a cold start, a `sos-alert`
  service-worker message while open), and that sheet opens immediately — without
  it the first poll only drew a banner, so tapping the notification appeared to
  do nothing. `POST /respond` uses
  browser coords → stored heartbeat, and refuses with "Turn on location" when
  neither exists; success starts the responder WS channel and shows
  ETA/distance. Terminal statuses raise a toast. There is no fabricated
  fallback (the Bali constant is gone). The heartbeat awaits
  `browserPosition()` (`$lib/geo.js`, shared with the map and the SOS trigger)
  before each `PUT`; it publishes on movement (≥25 m, at most every 10 s) as
  well as the 60 s keepalive, skips the `PUT` when no fix younger than 2
  minutes exists (a dead GPS ages out instead of being republished as fresh),
  and re-acquires on `visibilitychange`. It also starts/stops
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
- `src/lib/components/HomeView.svelte` — full-bleed, map-first home:
  a fullscreen `MapCard` is the surface. At the top is a full-bleed gradient
  header (`from-white via-[#F8FAFF] to-[#EAF1FB]`) — no outer top/side gap,
  20 px top padding and 16 px bottom padding — with `Hi, <first name>`, the
  date beneath it, an outlined `$place` chip whose small MapPin glows blue, a
  `Responders · <count>` line with a pulsing live dot, the OSM credit, and
  40 px bell/profile buttons that navigate to Alerts/Profile. There is no
  MapPin tile beside the greeting. It is informational only
  (`pointer-events-none`); the credit link and the two buttons re-enable
  pointer events.
  The date switches to the short form below 360 px, and the header refreshes on
  a minute clock together with the incoming alert's age. There is no greeting
  card, lower-left panel, or quick-action sheet — Call 112, Share location, and
  Contacts live on their own pages/nav. The incoming banner and right-side
  recenter/radius controls flow 12 px below the header; controls hide while the
  banner is up. `App.svelte` gives Home a non-scrolling full-height viewport
  (the other tabs still scroll) and keeps it mounted (hidden) so returning to
  Home reuses the same Leaflet map; it no longer owns a poller or geolocation
  call. Location is read-only in Home: `responders`,
  `nearbyRadius`/`nearbyLoading`/`nearbyReady`/`nearbyError` come from
  `$lib/geo.js`, the own
  pin is `$liveFix ?? $own` (live GPS with heartbeat fallback, plus the accuracy
  circle), and the
  header shows `$place` (`Locating…`, then `Location unavailable` when the
  heartbeat/geocoder has no answer). The `Responders` line never lies: it reads
  `N nearby · 1 km` / `None nearby · 1 km` only for a real answer at the current
  radius, and otherwise `Locating…`/`Checking…`/`$nearbyError` — do not collapse
  those back into `None nearby`. The radius button switches the **search**
  radius between 1 km (default) and 5 km (`setNearbyRadius`, calls
  `refreshNearby()`), so the circle and the count describe the same search, and
  the header's radius label follows. Recenter calls the exposed
  `mapRef.recenter()`. Home's props are `user`, `onnavigate`, `incoming`,
  `onviewalert`, `ondismissincoming`, `coords`, and `live`.
- `src/lib/components/MapCard.svelte` — Leaflet + OpenStreetMap map (no
  token). Props: `own` (`GET /api/location` payload or `liveFix`; a finite
  `accuracy` draws the blue uncertainty circle), `responders`
  (`nearby` items), `focus` (incoming alert location; centers the map and draws
  an amber pin), `live` (tracking store frame), `radiusM`, `height` (height
  class; the incoming sheet passes `h-[132px]`), `showControls`,
  `showRadiusDefault`, `radiusVisible` (controlled override for the circle),
  `fullscreen` (absolute inset-0 surface, no controls/footer, softer radius
  fill, Home's mode), `showFooter`, `showAttribution` (Leaflet's own credit).
  It exposes `recenter()`. Draws the radius circle (dashed `#FF3B30`, 1.5 px,
  stroke 0.55 / fill 0.11; fullscreen uses stroke 0.50 / fill 0.06), blue own
  dot, generic masked responder pins, and a pulsing red pin that follows
  `LOCATION_UPDATE`; the live pin is removed on terminal status. A
  `ResizeObserver` re-measures the container (`map.invalidateSize()`) so the map
  survives being hidden and shown.
- `src/lib/components/AlertIncoming.svelte` — real inbox alert sheet. Receives
  one `AlertDetailResponse`, computes approximate distance from own coords to
  the masked location, and calls the app's respond handler. It also takes the
  responder's tracking store and the `responded` record: the sheet stays open
  after `POST /respond` as the responder's live view (ETA line, the victim's
  moving pin on the map) and prefers an `ALERT_TRIAGE` re-classification over the
  inbox payload, flagging it with a "Re-classified from the audio" chip. Its "On
  the way" list shows the caller as "You" (ETA/distance from the respond
  response) plus every other responder appended by `RESPONDER_ADDED` on this
  channel, nearest first and with the caller filtered out by `youId` — their own
  socket connects after `POST /respond`, so their own frame never arrives and
  would otherwise duplicate the row. Once the viewer has responded the sheet
  also renders `<AlertMedia>` (the sender's clip, gated on `responded` because
  the media routes are participant-only). The app drops the sheet once the alert
  reaches a terminal status.
- `src/lib/components/AlertMedia.svelte` — the responder's evidence player
  (`alertId` + `enabled`). Three backend facts drive it: the stream endpoint
  needs the raw `Authorization` header, so each clip is fetched with
  `sos.mediaBlob()` into an object URL (`<audio>`/`<video>` cannot carry the
  header); there is no `MEDIA_ADDED` frame and `AlertDetailResponse` has no media,
  so it polls `GET /api/sos/:id/media` every 12 s while the sheet is open
  (skipping ticks on a hidden tab, catching up on `visibilitychange`); and only a
  recorded responder may read media, so it stays inert until `enabled`. Blobs are
  cached per media id for the life of the sheet and every object URL is revoked
  on close/switch (a `generation` counter drops late responses and late blob
  writes for the previous alert). Each row shows the clip type, size and age, a
  native `controls` player, and the server's transcript — or the
  `transcription_status` reason (`disabled`/`too_large`/`empty`/`failed`) when
  there is none. `403` is treated as "not a participant yet" and 412/404 are
  permanent (no retry), other failures are retried on the next poll. The section
  renders at all only when a clip exists, so an alert with a blocked microphone
  adds nothing to the sheet.
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
  triage card leads the active screen (above the map) and is always rendered:
  header "AI triage · from your audio / from your description / not classified",
  a type icon (the raw enum used to be printed inside a 36px badge, where it
  overflowed as a second copy of the label), the type label with the server's
  summary when it sends one, the severity bar and the fan-out copy when a level
  is known, and an "Audio transcript · 10 s clip" block — the quoted text, the
  transcription note (`disabled`/`too_large`/`empty`/`failed`), "No transcript
  was returned for this clip", or "No audio was recorded" when the microphone was
  blocked. `applyTriage()` moves it off the description as the classify response,
  the media response or an `ALERT_TRIAGE` frame lands; with no classification at
  all it says so instead of disappearing. When the media response escalated the
  fan-out it also adds "+N responders at the wider radius" and the notified count
  includes them. The active screen carries its own map
  (168 px: the live pin from the tracking socket, the fan-out radius circle at
  the same tier the text claims, recenter and radius controls) because the sheet
  covers Home, which was the only map — a sender could not see the alert on any
  map while it was open. "Responders notified" renders the responders the backend
  reports: `AlertDetailResponse.responders` polled every 10 s plus the
  `RESPONDER_ADDED` frames merged in by `user_id`, nearest first, each row with
  name (or "Responder" when the backend omits it), distance, ETA and when they
  answered; when the payload only carries `responders_en_route` the row falls
  back to a bare "N responders are on the way".
  Ending an active alert takes two taps — "I'm safe — end alert" arms
  `confirming`, the second tap sends `POST /resolve` — so a stray tap cannot
  stop a live alert. Starts tracking via `ontrack`, sends throttled breadcrumbs
  while active, shows the WS connection state, and ends on terminal
  `ALERT_STATUS`. There is no manual recorder: the countdown clip is the only
  one, and the active view just reports its receipt ("Sending your audio…" →
  "Audio received · responders can listen to your 10 s clip", the upload error,
  or "No audio was attached" when the microphone was blocked). The clip is
  dropped when the alert ends or the sheet closes.
- `src/lib/components/AlertsView.svelte` — server-side history. Two tabs only
  (`Sent` / `Received`, `role` query): `GET /api/sos/history` with the status
  chip (`all`/`active`/`closed`), 20-row pages and a "Load more" button. Each
  load carries a sequence guard so a slow response for the previous tab cannot
  overwrite the current one, and terminal rows show `resolved_at`/
  `cancelled_at` (`EXPIRED` has no timestamp, so it shows the trigger time). The
  three summary cards come from `GET /api/sos/summary` (`sent.total`,
  `responded.resolved`, `received.active`) and render `—` until it answers.
  Never derive totals from `active`/`inbox`: both are active-only.
- `src/lib/components/ContactsView.svelte` — emergency contacts.
- `src/lib/components/ProfileView.svelte` — profile + real settings. No mock
  identity and no fabricated numbers: `user` defaults to `{}`, the two stats are
  the live contact count (`contacts.list()`, `—` until it answers) and
  `$responders.length` from `$lib/geo.js`, and the emergency-info card is a
  read-only "No medical information saved" until the backend exposes a field to
  store it. Only two toggles exist, both wired: **Live location**
  (`$locationSharing` ↔ `locationSharing.update`) and **Push notifications**
  (`pushPermissionState()` on mount, `enablePush()`/`disablePush()` on click,
  `PUSH_HELP` copy in the row hint when it fails). Siren and auto-call were
  deleted — the backend supports neither.

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
        "distance_m": 300,
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
- The Home map can only show people who are actually publishing heartbeats: the
  backend drops candidates with no `users:last_seen` entry or an entry older than
  `staleThreshold` (2 minutes, `trigger_sos_usecase.go`), excludes the caller, and
  needs the caller's own heartbeat (`GET /api/location/nearby` answers `404`
  without one). So a device whose app is closed — or which only wakes up for push
  — never appears as a nearby pin, and an empty map is usually that rule rather
  than a rendering bug. Responder pins also share the masked ~100 m grid, so a
  pin can sit under the caller's own dot. **The nearby radius (1 km, Home can
  widen to 5 km) is not the fan-out radius**: `findRecipients` walks the
  adaptive tiers `[1000, 2000, 5000]` (`internal/config/notification.go`) upward
  until `MinRecipients` fresh users are found, so an alert can reach a device
  that the 1 km map never counted — that asymmetry is expected, not a bug.
  Diagnose a "the other phone never showed up" report with
  `GET /api/location` (is `last_seen` under 2 min?) before suspecting the UI.
- Who is coming is now visible: `AlertDetailResponse.responders`
  (`ResponderSummary`: `user_id`, optional `name`, `distance_m`, `eta_seconds`,
  `responded_at`) is **participant-only** — the sender and recorded responders
  get the list, any other authenticated viewer still keeps just
  `responders_en_route`. The active screen renders it (nearest first, "Responder"
  when the name is omitted) and falls back to the bare count when the list is
  absent, polling the detail every 10 s; `RESPONDER_ADDED` appends new arrivals
  immediately. Distances/ETA are the values recorded when the responder answered,
  not live positions.
- One active session per account: the backend stores the token on the user row
  (`users.token`), so logging in anywhere rotates it and revokes whatever session
  the account had before — a second device, a second browser profile, the
  installed home-screen app, or a double-submitted login form. The client then
  sees 401 on its next request and (correctly) signs out, which is why an "it
  logged me out by itself" report usually means a login happened elsewhere.
  Multi-device needs a session table server-side (one row per token).
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

## Interface standards

Distilled from `REVIEW-REPORT-DESIGN.md` (the full review) and the fixes that
followed it. Regressions here were what the review called out, so keep them.

- **Type floor**: 12 px for metadata and body copy, 11 px only for a single
  uppercase tag (`.eyebrow`, map chips, Leaflet attribution), headings 25–26 px.
  Every form input is `text-[16px]` — below 16 px iOS Safari zooms the page on
  focus.
- **Contrast**: `--color-muted` is `#5b6270` (5.96:1 on white, 5.46:1 on canvas)
  and is the only muted token; on dark surfaces use `text-white/60` or higher,
  never `white/30`–`white/50`. White on `#EE2B22` is 4.20:1, so no text below
  19 px sits directly on the SOS red.
- **Dialogs**: `role="dialog" aria-modal="true"` + accessible name + `use:trap`
  from `src/lib/focus.js` + inclusion in `App.svelte`'s `modalOpen` (which sets
  `inert` on the shell). Both halves are required.
- **Controls act or are not controls.** A `button` has a handler, a link has a
  real `href` (`tel:`, `sms:`, `https:`), and nothing reports success before the
  platform call resolved. Delete rather than decorate an unimplemented feature.
- **No backend internals in copy**: `emergencyLabel()` + `severityWord()` from
  `src/lib/alertMeta.js` replace raw enums and numeric scores.
- **The severity bar** uses an inline style (`sevWidth()` returns `"80%"`);
  Tailwind never emits an interpolated `w-[NN%]` class, so that form renders an
  empty bar.

## Verification

No frontend test suite. Run `npm run build` and verify the actual UI in a
browser at `http://localhost:5173` with the backend running.

Two behaviours are covered by browser regression scripts (real Vite dev server,
headless Chrome, a mock API on :3000 from `scripts/`): `npm run test:signout`,
`npm run test:radius`, and `npm run test:media` — the last one opens the
responder sheet via `/?alert=<id>`, asserts no media request before
`POST /respond`, then that the list and the stream both carry the raw token and
the clip plays from a `blob:` object URL.
