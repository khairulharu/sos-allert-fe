# SOS Alert — Frontend

A mobile-first UI/UX concept for a community SOS app. Built with **Svelte 5** and
**Tailwind CSS v4**, no UI kit — every screen and icon layout is custom.

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

The API base URL defaults to `http://localhost:3000`. Override it with an env file:

```bash
cp .env.example .env   # then set VITE_API_URL=...
```

## Already implemented (live, wired to the Go backend)

| Area | What works |
| --- | --- |
| **Auth** | Sign in / create account against `POST /api/users` + `/api/users/_login`; session token kept in `localStorage`; sign out. Raw token sent in the `Authorization` header (matches backend). |
| **Location heartbeat** | `PUT /api/location` sent at startup (browser geolocation) and every 60 s, so you appear as a nearby responder. |
| **SOS flow with AI triage** | Hold SOS → describe what happened → 5 s cancellable countdown → real `POST /api/sos` with description → **AI triage result card**: emergency type, severity 0–1 with bar, summary, and the 1/2/5 km responder radius the severity picked. "I'm safe — end alert" calls `POST /api/sos/:id/resolve`. |
| **Cancel** | Uses your **safe PIN** (`POST /api/sos/:id/cancel`); set the PIN via `PATCH /api/users/_current` `{"safe_pin":"1234"}`. |
| **Alerts** | Real history from `GET /api/sos/active` + `/api/sos/inbox`, merged and deduped, with status chips and severity/summary metadata. |
| **Contacts** | Real emergency contacts from `GET/POST /api/emergency-contacts`, with an inline add form. |
| **Profile** | Real user from `GET /api/users/_current` (name, created date), sign out wired. |

## Not yet implemented

- **WebSocket live tracking** (`/ws/sos/:alertId/track`) — live map pin movement is
  not driven by the real-time stream yet; the app relies on polling the detail API.
- **Media upload** (`POST /api/sos/:id/media`) — no camera/audio capture in the UI.
- **Incoming alert bottom sheet** — `AlertIncoming.svelte` still uses demo content;
  real-time notification/responder flows need WebSocket or FCM push wired up.
- **Push notifications (FCM/APNs)** — the demo runs in a browser; native push tokens
  are not registered.
- **AI provider**: the backend defaults to the **offline keyword classifier**
  (zero-cost, deterministic). To use a live LLM (OpenAI-compatible), set in the
  backend `config.json` → `ai.provider: "openai"` + `ai.openai.*` key; the UI
  displays whatever triage the backend returns, so it works with either.
- Map is a hand-drawn SVG (no token). Swap `MapCard.svelte` for Leaflet/Google Maps
  to show true roads.
- "Call 112" / "Message" actions show a toast instead of placing a real call.

## Project structure

```
src/
├── App.svelte                  # app shell, auth gate, view switching, SOS + toast orchestration
├── app.css                     # Tailwind theme, base styles, animations
├── main.js
└── lib/
    ├── api.js                  # fetch client for the Go backend (raw-token auth)
    ├── stores.js               # Svelte session store (login/register/logout/restore)
    ├── data.js                 # leftover demo fallback (ProfileView only)
    └── components/
        ├── AuthScreen.svelte   # sign in / create account
        ├── BottomNav.svelte    # floating nav with centered SOS button
        ├── SosButton.svelte    # hold-to-trigger button with progress ring
        ├── AlertFlow.svelte    # describe → countdown → sending → active + AI triage → safe
        ├── AlertIncoming.svelte# incoming SOS bottom sheet (demo content)
        ├── MapCard.svelte      # hand-drawn vector map (no API key needed)
        ├── HomeView.svelte
        ├── AlertsView.svelte
        ├── ContactsView.svelte
        └── ProfileView.svelte
```

## Design notes

- **Palette** — near-black ink, warm off-white canvas, signal red `#FF3B30` for emergency, emerald for "safe/protected", blue for location.
- **Type** — Inter with tight tracking for headings, tabular numerals for timers.
- **Motion** — breathing pins, SOS pulse rings, progress-ring countdown; everything respects `prefers-reduced-motion`.
- **Accessibility** — labelled icon buttons, `aria-current` nav state, `aria-checked` switches, keyboard-hold SOS support, focus rings, live status text.
