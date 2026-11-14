# SOS Alert — Frontend

A mobile-first community emergency-response app built with **Svelte 5**, **Vite 6**,
**Tailwind CSS v4**, and **Leaflet + OpenStreetMap**. The UI is custom; there is no
component library.

The frontend is wired to the companion **Go/Fiber backend** in `../backend`. It
supports real authentication, SOS creation, audio-driven AI triage, evidence upload,
nearby-responder discovery, incoming alerts, live WebSocket tracking, and browser
Web Push.

> Detailed implementation and backend handoff notes: [`AGENTS.md`](./AGENTS.md).
>
> Mirrored API contract: [`api/api-spec.json`](./api/api-spec.json) ·
> [`api/api.md`](./api/api.md). The backend copies remain authoritative.

## Run locally

```bash
npm install
npm run dev
```

Open **http://localhost:5173**. The backend must be running separately:

```bash
cd ../backend
go run cmd/web/main.go
```

The API defaults to `http://localhost:3000`. Override the HTTP and WebSocket base
URLs through `.env`:

```bash
cp .env.example .env
```

```dotenv
VITE_API_URL=http://localhost:3000
VITE_WS_URL=ws://localhost:3000
```

If `VITE_WS_URL` is empty, the app derives it from `VITE_API_URL` (`http` → `ws`,
`https` → `wss`).

Backend CORS currently allows only `https://allert.my.id` and
`http://localhost:5173`. Use that exact local origin; `127.0.0.1`, LAN URLs, and
Vite preview on port 4173 fail preflight unless the backend allowlist is changed.

## Production build

```bash
npm ci
npm run build
```

The static output is written to `dist/`. `.env.production` already contains:

```dotenv
VITE_API_URL=https://api.allert.my.id
VITE_WS_URL=wss://api.allert.my.id
```

These values are compiled into the JavaScript bundle. Real environment variables
override the file during CI/deployment. `npm run preview` can inspect the build,
but its default origin is not accepted by the current backend CORS configuration.

## Implemented and wired

| Area | Current behavior |
| --- | --- |
| **Authentication** | Register, sign in, restore a session, fetch the current profile, and sign out through the real user API. The raw session token is sent in `Authorization` without a `Bearer` prefix. Login/registration `429` responses show a cooldown; SOS `429` responses show a dedicated limit screen. |
| **SOS creation** | Hold the center SOS button, describe the emergency, then pass through a **10-second cancellable countdown**. Cancelling during the countdown closes the flow without creating an alert. Trigger requests include an idempotency key. |
| **Audio-driven triage** | The countdown is also the audio-recording window. Before the SOS is created, the clip is sent to `POST /api/sos/classify`; successful classification supplies `emergency_type`, `severity`, and `summary` for the first responder fan-out. |
| **Fail-open emergency flow** | A blocked microphone, unavailable STT service, classification failure, or offline classification request does not prevent the SOS. The app falls back to description-based triage and clearly reports when no audio was attached. |
| **Evidence and re-classification** | After the SOS is created, the same clip is uploaded to `POST /api/sos/:alertId/media`. The active screen shows upload state, transcript/transcription status, and updated triage. If the transcript raises severity, the backend can widen the radius and the UI reports the additional responders notified. |
| **Active alert screen** | Shows AI triage and its source, severity and fan-out radius, transcript, live map, WebSocket state, responder notifications, and responder distance/ETA/status. Ending an alert requires two taps and calls `POST /api/sos/:alertId/resolve`; if that request fails the screen stays on the live alert and says why instead of claiming it ended. |
| **Sender live tracking** | Opens `/ws/sos/:alertId/track` with no token in the URL and authenticates in-band as the first frame (`{"type":"auth"}` → `{"type":"auth_ok"}`, 10 s deadline), then sends location breadcrumbs every 5 seconds. Resumes an owned active alert after reload/login and reconnects with exponential backoff. Handles `LOCATION_UPDATE`, `ALERT_STATUS`, `ALERT_TRIAGE`, and `RESPONDER_ADDED` frames. |
| **Responder map** | Leaflet + OpenStreetMap with the caller's heartbeat, radius circle, live alert pin, and masked nearby-responder pins. The location heartbeat runs every 60 seconds; nearby responders refresh every 15 seconds. Returning to Home does not rebuild the map or restart the location flow. |
| **Incoming responder alerts** | Polls `GET /api/sos/inbox` every 12 seconds and immediately after push/visibility events. New alerts open a real sheet; existing alerts appear as a Home banner. `POST /api/sos/:alertId/respond` returns distance/ETA and starts the responder's read-only WebSocket view of the sender. |
| **Browser Web Push** | The Profile toggle requests permission, registers `public/sw.js`, creates a VAPID subscription, and stores it through the backend. Notifications can focus/open the app on the relevant alert. Sign-out and session expiry remove the subscription before tearing down the session. Requires HTTPS or localhost. |
| **Alerts and contacts** | The Alerts screen is server-side history: `GET /api/sos/history` with **Sent**/**Received** tabs, an all/active/closed filter, 20-row pages and "Load more", plus the three summary cards from `GET /api/sos/summary` (shown as `—` until they answer). Emergency contacts support real list and create operations, plus local search/filtering. |
| **Install presentation** | Web manifest, favicon, Apple touch icon, and 192/512 px install icons are present. The service worker handles push notifications only; it does not provide an offline application cache. |

## SOS and audio sequence

1. The user holds SOS and enters a description.
2. The 10-second countdown starts. It is both the cancellation window and the
   `MediaRecorder` capture window.
3. When the countdown ends, recording stops and the clip is classified before the
   alert exists. This request persists nothing.
4. The app creates the SOS with coordinates, description, and—when available—the
   audio-derived triage. Severity selects the 1 km, 2 km, or 5 km fan-out radius.
5. The clip is uploaded again as persisted evidence. The media response or a later
   `ALERT_TRIAGE` WebSocket frame can update the triage card; a severity increase
   can trigger backend re-fanout.
6. While active, the sender broadcasts breadcrumbs and the screen merges polled
   responder details with `RESPONDER_ADDED` frames.
7. Resolving the alert stops tracking. Closing or ending the flow discards the
   local clip.

The same audio is transcribed once for pre-trigger classification and once by the
media endpoint. There is no manual recorder or additional-clip flow in the current
UI.

## Not implemented or still demonstrative

- **False-alarm cancellation:** the API client has a cancel method, but the UI does
  not configure the backend-required `safe_pin` or expose the PIN cancellation
  flow. Users currently end their own alert with **resolve**.
- **Video capture and media outside the responder sheet:** no camera capture or
  media download, and the sender only sees an upload receipt. A recorded responder
  plays the sender's clip (and its transcript) inside the incoming sheet.
- **Native device push:** FCM/APNs device tokens are not wired. Browser Web Push
  and inbox polling are the implemented delivery paths.
- **Nearby responder names:** the nearby-location API returns masked coordinates
  and user IDs, so the general map uses generic "Responder" labels. Friendly names
  require a backend/privacy decision.
- **Profile placeholders:** there is no profile editor, no medical-information
  editor (that card is read-only, because the user API has no field to store it),
  and no privacy/help links. Both toggles — **Live location** and **Push
  notifications** — are wired; the old siren/auto-call toggles were deleted
  because the backend supports neither.
- **Offline use:** there is no offline SOS queue or cached application shell.

## Project structure

```text
public/
├── manifest.webmanifest         # install metadata
├── sw.js                        # push rendering and notification-click routing
└── icons/                       # install icons
scripts/                         # headless-Chrome regression checks (npm run test:*)
src/
├── App.svelte                   # auth gate, app shell, heartbeat, inbox/push/WS orchestration
├── app.css                      # Tailwind theme, base styles, animations
├── main.js                      # Svelte entry point
└── lib/
    ├── api.js                   # REST client, raw-token auth, multipart uploads, 401 hook
    ├── stores.js                # session persistence
    ├── geo.js                   # shared location state and nearby polling
    ├── tracking.js              # sender/responder WebSocket channels
    ├── push.js                  # Web Push permission and subscription lifecycle
    ├── mic.js                   # microphone permission and error handling
    ├── place.js                 # cached Nominatim reverse geocoding
    ├── focus.js                 # dialog focus trap action
    ├── rateLimit.js             # Retry-After parsing and cooldown formatting
    ├── alertMeta.js             # labels, severity tiers, distance/ETA, haversine distance
    └── components/
        ├── AuthScreen.svelte    # sign in / create account
        ├── BottomNav.svelte     # floating navigation with centered SOS button
        ├── SosButton.svelte     # pointer/keyboard hold-to-trigger control
        ├── AlertFlow.svelte     # SOS, audio, triage, active alert, and resolve flow
        ├── AlertIncoming.svelte # incoming alert and responder live view
        ├── AlertMedia.svelte    # responder evidence player (fetched blob + transcript)
        ├── MapCard.svelte       # Leaflet map and alert/responder markers
        ├── HomeView.svelte      # map-first home with header and incoming banner
        ├── AlertsView.svelte    # server-side sent/received history
        ├── ContactsView.svelte  # emergency contacts
        └── ProfileView.svelte   # profile and the two real toggles
```

## Backend integration notes

- Success responses use `{ "data": ... }`; errors use
  `{ "errors": "message" }` with the HTTP status.
- Timestamps are epoch milliseconds.
- Protected requests use the raw token, not `Bearer <token>`.
- The backend currently keeps one session token per account. Logging in elsewhere
  rotates that token and the previous client signs out on its next `401`.
- Nearby coordinates are masked to roughly 100 m. Only users with a recent
  heartbeat appear as responders; an empty map commonly means no other fresh
  heartbeat exists.
- WebSocket terminal statuses are `RESOLVED`, `CANCELLED`, and `EXPIRED`.
- Browser push needs secure context and backend Web Push/VAPID configuration.
  Audio transcription and live AI keys remain backend-only; never put them in
  frontend env files or source.

## Design and accessibility

- Near-black ink, warm off-white canvas, signal red for emergencies, emerald for
  safety, and blue for location.
- Full-screen mobile layout with a centered 430 px app shell on larger screens.
- Labelled icon buttons, keyboard-operable SOS hold, focus rings, navigation state,
  switch state, and live status text.
- Reduced-motion support for pulses and transitions.

## Verification

```bash
npm run build
```

Then verify the real UI at `http://localhost:5173` with the backend running,
including authentication, SOS/audio fallback, incoming response, maps, WebSocket
tracking, and push permission behavior.

Seven behaviours are locked by regression scripts (six run the real app against a
mock API on :3000 through the Vite dev server and headless Chrome; `test:push`
needs no browser):

| Script | Covers |
| --- | --- |
| `npm run test:signout` | a sign-out leaves no location request pointing at the dead session |
| `npm run test:radius` | a radius tap during a poll is sent and survives a stale answer |
| `npm run test:media` | responder media is gated on `POST /respond`, fetched with the raw token, played from a `blob:` URL |
| `npm run test:ws` | the tracking socket has no `?token=`, sends `{"type":"auth"}` first, queues breadcrumbs until `auth_ok` |
| `npm run test:session` | a failed login is not a session end; any 401 signs out exactly once |
| `npm run test:resolve` | a failed `POST /resolve` keeps the alert active and reports the failure |

`test:push` runs the service worker in a Node sandbox and asserts that the
notification carries `alert_id` and that a tap posts `{type:'sos-alert'}` (open
window) or opens `/?alert=<id>` (cold start). All of them run in CI.
