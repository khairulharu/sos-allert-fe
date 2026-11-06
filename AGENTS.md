# AGENTS.md — SOS Alert Frontend

Svelte 5 + Vite + Tailwind v4 mobile-first UI for the SOS Allert backend.
Companion backend: `../backend` (Go/Fiber, module `golang-clean-architecture`).
Backend state at handoff: commit `cf328eb` (location APIs + full API contract).

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
- Both files are mirrored from `../backend/api/` at backend commit `cf328eb`.
  The backend copy remains the source of truth; re-copy after backend API
  changes. The frontend copy exists so a session opened in this repo has the
  contract without leaving the workspace.
- Auth header: raw session token, **no `Bearer ` prefix**.
  `POST /api/users/_login` returns `data.token`.
- Success envelope: `{ "data": ... }`; contact list also has `{ "paging": ... }`.
- Error envelope: `{ "errors": "<message>" }` with the HTTP status.
- All timestamps are epoch milliseconds (`int64`).
- CORS allows `http://localhost:5173` (and other origins) with
  `Authorization` and `X-Idempotency-Key`.
- Protected routes: everything except `POST /api/users`,
  `POST /api/users/_login`, and `GET /metrics`.

## Current frontend state

- Live/wired: register/login/logout, current profile, location heartbeat,
  SOS trigger + AI triage card + resolve, alerts (active + inbox), cancel
  with Safe PIN, emergency contacts list/create, Leaflet/OSM responder map
  (own heartbeat + `GET /api/location/nearby` polled every 15 s; masked pins
  and generic "Responder" rows, no names), sender-side WebSocket live tracking
  (`/ws/sos/:alertId/track?token=`; breadcrumbs every 5 s, live pin,
  `ALERT_STATUS`).
- Not wired yet:
  - media upload/download;
  - native push (FCM/APNs);
  - responder-side tracking UI (`AlertIncoming.svelte` is demo content; the
    WS client in `tracking.js` is generic but only the sender's own alert is
    subscribed today).

## Important files

- `src/lib/api.js` — fetch wrapper, raw token, API base URL.
- `src/lib/tracking.js` — WebSocket live-tracking store. Builds the WS URL
  (`VITE_WS_URL` or `ws(s)://` derived from `VITE_API_URL`), sends the raw token
  as `?token=`, reconnects with exponential backoff, queues breadcrumbs while
  connecting, and stops on terminal `ALERT_STATUS` or an `{error}` frame.
  Exports `tracking`, `startTracking(alertId, seed)`, `stopTracking()`,
  `sendBreadcrumb(fields)`.
- `src/lib/stores.js` — session store. **Do not regress** `restoreSession()`:
  it must use `getToken()` (localStorage key `sos_alert_token`), never
  `user.id`. Using `user.id` caused every authenticated call after login to
  return 401 (fixed in commit `97dc741`).
- `src/App.svelte` — auth gate, geolocation heartbeat every 60 s, toast, and
  WS orchestration. On restore/login it calls `GET /api/sos/active` once and
  starts tracking the user's active alert; trigger passes the new id through
  `ontrack`. Terminal `ALERT_STATUS` while Home is visible raises a toast.
  Fallback coords are Bali (`-8.65, 115.22`) if browser geolocation is denied;
  heartbeat errors are currently swallowed.
- `src/lib/components/HomeView.svelte` — protection card, responder count,
  quick actions. Also owns the nearby polling: syncs own heartbeat, calls
  `location.nearby(1000)` every 15 s (skipped while the tab is hidden), and
  calls `onsessionexpired` on `401` so `App.svelte` logs out.
- `src/lib/components/MapCard.svelte` — Leaflet + OpenStreetMap map (no
  token). Props: `own` (`GET /api/location` payload), `responders`
  (`nearby` items), `live` (tracking store frame), `radiusM`. Draws the radius
  circle, blue own dot, generic masked responder pins, and a pulsing red pin
  that follows `LOCATION_UPDATE`; the live pin is removed on terminal status.
- `src/lib/components/AlertFlow.svelte` — describe → 5 s countdown → trigger →
  triage → resolve. Starts tracking via `ontrack`, sends throttled breadcrumbs
  while active, shows the WS connection state, and ends on terminal
  `ALERT_STATUS`.
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
2. `HomeView` syncs an accurate browser position once, then reads the stored
   heartbeat. If `GET /api/location` is `404`, it `PUT`s the app's last known
   coordinates and retries `GET`; it never blocks on geolocation.
3. `HomeView` polls `nearby(1000)` every 15 s, skipping ticks while the tab is
   hidden. Pins and the list update reactively.
4. `MapCard.svelte` is Leaflet + OSM, centered on own coords, with radius
   circle, recenter, and radius toggle controls. It keeps the `max-w-[430px]`
   shell and existing card styling.
5. `401` from location APIs invokes `onsessionexpired` → `logout()` in
   `App.svelte`, returning to the auth screen.

Remaining map work: backend name lookup (privacy decision) for friendly labels,
a fullscreen/responder-detail view, and responder-side WS tracking once the
incoming-alert sheet is real.

## Live tracking protocol notes

- WS URL: `ws(s)://<ws-base>/ws/sos/:alertId/track?token=<raw token>`; no
  `Bearer` prefix. `tracking.js` uses `VITE_WS_URL` or derives the base from
  `VITE_API_URL`.
- The server sends no initial snapshot: seed from the trigger response or
  `GET /api/sos/active` (App does this once, no polling), then apply frames.
- Only the sender sends breadcrumb JSON. Responders are subscribe-only; their
  sends are rejected by the backend and echoed as `{error}`.
- Frames: `{type:"LOCATION_UPDATE",latitude,longitude,speed_mps?,heading_deg?}`
  and `{type:"ALERT_STATUS",status,updated_at}`.
- `RESOLVED`, `CANCELLED`, and `EXPIRED` are terminal: stop reconnecting and
  remove the live pin. `EXPIRED` is not currently broadcast by the backend
  scheduler, so treat a closed socket as reconnectable until status arrives.
- Reconnect uses exponential backoff (1/2/4/8/15 s); an `{error}` frame is
  fatal (no reconnect) because it means auth/authorization failed.

## Backend notes / known gaps

- Dev DB migrations are at `20261107000000_locations_user_unique`; other
  environments need `migrate up` (see `../backend/README.md`).
- Nearby respond coords are masked; do not expect exact positions.
- FCM/APNs/Twilio credentials are not configured, so push is log-only.
- Pending backend items: push credentials, media frontend wiring, responder
  incoming-alert WS UI, Redis GEO TTL/cleanup, and optional user names in
  nearby results.
- `backend/config.json` and `ca.pem` are gitignored; never commit them here.

## Verification

No frontend test suite. Run `npm run build` and verify the actual UI in a
browser at `http://localhost:5173` with the backend running.
