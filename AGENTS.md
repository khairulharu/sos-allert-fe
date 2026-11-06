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

- Full spec: `../backend/api/api-spec.json`
- Human summary: `../backend/api/api.md`
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
  with Safe PIN, emergency contacts list/create.
- Not wired yet:
  - real map (MapCard is a static SVG with hardcoded pins);
  - nearby responders (`HomeView` uses `responders = []`);
  - WebSocket live tracking (`/ws/sos/:alertId/track?token=`);
  - media upload/download;
  - native push (FCM/APNs);
  - incoming alert sheet (`AlertIncoming.svelte` is demo content).

## Important files

- `src/lib/api.js` — fetch wrapper, raw token, API base URL.
- `src/lib/stores.js` — session store. **Do not regress** `restoreSession()`:
  it must use `getToken()` (localStorage key `sos_alert_token`), never
  `user.id`. Using `user.id` caused every authenticated call after login to
  return 401 (fixed in commit `97dc741`).
- `src/App.svelte` — auth gate, geolocation heartbeat every 60 s, toast.
  Fallback coords are Bali (`-8.65, 115.22`) if browser geolocation is denied;
  heartbeat errors are currently swallowed.
- `src/lib/components/HomeView.svelte` — protection card, responder count,
  quick actions.
- `src/lib/components/MapCard.svelte` — static map; replace with Leaflet or
  MapLibre (no token required) for the responder map.
- `src/lib/components/AlertFlow.svelte` — describe → 5 s countdown → trigger →
  triage → resolve.
- `src/lib/components/AlertsView.svelte` — active + inbox merge/dedupe.
- `src/lib/components/ContactsView.svelte` — emergency contacts.
- `src/lib/components/ProfileView.svelte` — profile + settings toggles.

## Location API for the responder map

Add to `src/lib/api.js`:

```js
export const location = {
  update: (latitude, longitude) =>
    request('PUT', '/api/location', { latitude, longitude }),
  get: () => request('GET', '/api/location'),
  nearby: (radiusM = 1000) =>
    request('GET', `/api/location/nearby?radius_m=${radiusM}`),
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

## Suggested map implementation

1. Add `location.get()` + `location.nearby()` to `api.js`.
2. On Home mount, fetch own location; if `404`, prompt for location permission
   and retry after the next heartbeat.
3. Poll `nearby(1000)` every 10–15 s (or on heartbeat) and render masked pins.
4. Replace `MapCard.svelte` with Leaflet/MapLibre; center on own coords.
5. Handle `401` by redirecting to login (token is invalid/expired).
6. Keep the existing app shell and visual language; map should fit the
   `max-w-[430px]` mobile card.

## Backend notes / known gaps

- Dev DB migrations are at `20261107000000_locations_user_unique`; other
  environments need `migrate up` (see `../backend/README.md`).
- Nearby respond coords are masked; do not expect exact positions.
- FCM/APNs/Twilio credentials are not configured, so push is log-only.
- Pending backend items: push credentials, WebSocket/media frontend wiring,
  Redis GEO TTL/cleanup, and optional user names in nearby results.
- `backend/config.json` and `ca.pem` are gitignored; never commit them here.

## Verification

No frontend test suite. Run `npm run build` and verify the actual UI in a
browser at `http://localhost:5173` with the backend running.
