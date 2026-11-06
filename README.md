# SOS Alert — Frontend

> Agent/context handoff notes (backend contract, current state, next tasks):
> [`AGENTS.md`](./AGENTS.md).
>
> API contract: [`api/api-spec.json`](./api/api-spec.json) ·
> [`api/api.md`](./api/api.md).

A mobile-first UI/UX concept for a community SOS app. Built with **Svelte 5**,
**Tailwind CSS v4**, and **Leaflet + OpenStreetMap** for the live responder map.
No UI kit — every screen and icon layout is custom.

The app is designed around one idea: in an emergency, help should be one gesture
away. Press and **hold** the red SOS button in the middle of the bottom navigation
to start the alert flow. When you describe what happened, the backend runs **AI
triage** and shows the result (emergency type, severity, summary) live on screen.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173. The layout is responsive: full-screen on mobile and a
centered app shell on desktop.

```bash
npm run build     # production build to dist/
npm run preview   # preview the build
```

The API base URL defaults to `http://localhost:3000`; the WebSocket base is
derived from it (`http` → `ws`, `https` → `wss`). Override either with an env file:

```bash
cp .env.example .env
# VITE_API_URL=https://api.allert.my.id
# VITE_WS_URL=wss://api.allert.my.id
```

`npm run build` reads `.env.production`, which already points at
`https://api.allert.my.id` / `wss://api.allert.my.id`. Real environment
variables override those defaults in CI. Deploy the generated `dist/` directory
as static files; `dist/` is gitignored, so run the build on the deploy host or
in CI:

```bash
npm ci
npm run build   # artifact: dist/
```

## Already implemented (live, wired to the Go backend)

| Area | What works |
| --- | --- |
| **Auth** | Sign in / create account against `POST /api/users` + `/api/users/_login`; session token kept in `localStorage`; sign out. Raw token sent in the `Authorization` header (matches backend). |
| **Rate limits** | Auth `429` (5/min/IP + 15 min lockout): countdown from `Retry-After` when readable, otherwise a 15-minute fallback; submit disabled. SOS `429` (3 triggers/hour/user): dedicated "SOS limit reached" screen, no retry loop, call-112 prompt. |
| **Location heartbeat** | `PUT /api/location` sent at startup (browser geolocation) and every 60 s, so you appear as a nearby responder. |
| **Responder map** | Leaflet + OpenStreetMap (no API token). Centers on your heartbeat, draws the 1 km radius, masked responder pins and a live list from `GET /api/location/nearby`; polls every 15 s. Backend returns only `user_id` + ~100 m-rounded coordinates, so the UI shows generic "Responder" rows and pins. |
| **Live tracking (WebSocket)** | The sender's active alert connects to `WS /ws/sos/:alertId/track?token=<raw token>`, sends a breadcrumb every 5 s (throttled), and applies `LOCATION_UPDATE` / `ALERT_STATUS` frames. The live pin moves on the Home map; acknowledge/resolve/cancel/expire update the active UI. Reconnects with backoff, and cold start resumes the own active alert via `GET /api/sos/active`. The backend also emits `ALERT_TRIAGE` after audio transcription; the UI does not handle that frame yet. |
| **Incoming responder alerts** | Polls `GET /api/sos/inbox` every 12 s while authenticated. Pre-existing alerts show as a Home banner; new alerts from a later poll auto-open the real `AlertIncoming` sheet with sender, type, summary, message and approximate distance (computed from your heartbeat + masked coords). "I'm coming" calls `POST /api/sos/:id/respond` and shows the returned ETA/distance, then subscribes to that alert's WS stream for the victim's live pin and status. |
| **SOS flow with AI triage** | Hold SOS → describe what happened → 5 s cancellable countdown → real `POST /api/sos` with description → **AI triage result card**: emergency type, severity 0–1 with bar, summary, and the 1/2/5 km responder radius the severity picked. "I'm safe — end alert" calls `POST /api/sos/:id/resolve`. |
| **Audio evidence** | While the alert is active, record up to 10 s with `MediaRecorder`, then upload as `multipart/form-data` (`file`) to `POST /api/sos/:id/media`. Shows recording countdown, upload state, permission/upload errors, and supports additional clips. Audio only (backend also accepts video, not captured). Backend transcribes audio ≤ 25 MB (Groq/Whisper-compatible) and returns `transcript`, `transcription_status`, and updated `triage`; the UI does not render those fields yet. |
| **Cancel** | Uses your **safe PIN** (`POST /api/sos/:id/cancel`); set the PIN via `PATCH /api/users/_current` `{"safe_pin":"1234"}`. |
| **Alerts** | Real history from `GET /api/sos/active` + `/api/sos/inbox`, merged and deduped, with status chips and severity/summary metadata. |
| **Contacts** | Real emergency contacts from `GET/POST /api/emergency-contacts`, with an inline add form. |
| **Profile** | Real user from `GET /api/users/_current` (name, created date), sign out wired. |

## Not yet implemented

- **Video capture / media playback** — only 10 s audio is recorded and uploaded;
  no camera capture and no in-app playback of uploaded evidence yet.
- **Audio triage UI / `ALERT_TRIAGE`** — the backend transcribes uploaded audio
  and broadcasts an `ALERT_TRIAGE` WebSocket frame, but the frontend does not
  render the transcript or updated classification yet.
- **Backend STT key** — Groq key lives only in
  `../backend/config.json` → `ai.stt.api_key`; never add it to `.env` or
  frontend code.
- **Push notifications (FCM/APNs)** — the demo runs in a browser; native push
  tokens are not registered, so incoming alerts rely on inbox polling (12 s)
  instead of instant push delivery.
- **AI provider**: the backend defaults to the **offline keyword classifier**
  (zero-cost, deterministic). To use a live LLM (OpenAI-compatible), set in the
  backend `config.json` → `ai.provider: "openai"` + `ai.openai.*` key; the UI
  displays whatever triage the backend returns, so it works with either.
- "Call 112" / "Message" actions show a toast instead of placing a real call.
- Nearby responders are anonymous (generic labels/pins). Adding names needs a
  backend lookup plus a privacy decision.

## Project structure

```
src/
├── App.svelte                  # app shell, auth gate, view switching, SOS + toast orchestration
├── app.css                     # Tailwind theme, base styles, animations
├── main.js
└── lib/
    ├── api.js                  # fetch client for the Go backend (raw-token auth)
    ├── tracking.js             # WS live tracking store (connect/reconnect/breadcrumbs)
    ├── rateLimit.js            # 429 Retry-After parsing + countdown formatting
    ├── alertMeta.js            # alert labels, relative time, haversine distance
    ├── stores.js               # Svelte session store (login/register/logout/restore)
    ├── data.js                 # leftover demo fallback (ProfileView only)
    └── components/
        ├── AuthScreen.svelte   # sign in / create account
        ├── BottomNav.svelte    # floating nav with centered SOS button
        ├── SosButton.svelte    # hold-to-trigger button with progress ring
        ├── AlertFlow.svelte    # describe → countdown → sending → active + AI triage → safe
        ├── AlertIncoming.svelte# incoming SOS bottom sheet (demo content)
        ├── MapCard.svelte      # Leaflet/OSM map: own dot, masked pins, radius
        ├── HomeView.svelte     # protection card, live nearby responders (15 s poll)
        ├── AlertsView.svelte
        ├── ContactsView.svelte
        └── ProfileView.svelte
```

## Design notes

- **Palette** — near-black ink, warm off-white canvas, signal red `#FF3B30` for emergency, emerald for "safe/protected", blue for location.
- **Type** — Inter with tight tracking for headings, tabular numerals for timers.
- **Motion** — breathing pins, SOS pulse rings, progress-ring countdown; everything respects `prefers-reduced-motion`.
- **Accessibility** — labelled icon buttons, `aria-current` nav state, `aria-checked` switches, keyboard-hold SOS support, focus rings, live status text.
