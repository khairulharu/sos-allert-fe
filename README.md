# SOS Alert — Frontend

A mobile-first UI/UX concept for a community SOS app. Built with **Svelte 5** and **Tailwind CSS v4**, no UI kit — every screen and icon layout is custom.

The app is designed around one idea: in an emergency, help should be one gesture away. Press and **hold** the red SOS button in the middle of the bottom navigation to start the alert flow.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173. The layout is responsive: full-screen on mobile and a centered app shell on desktop.

```bash
npm run build     # production build to dist/
npm run preview   # preview the build
```

## Screens

| Screen | What's inside |
| --- | --- |
| **Home** | Greeting, protection status, live safety map with 1 km radius, incoming SOS alert banner, quick actions, nearby responders, recent activity |
| **SOS flow** | Hold-to-confirm button → 5 s cancellable countdown → sending state → active alert with live map, responder statuses, call/message actions, "I'm safe" confirmation → safe summary |
| **Nearby alert** | Bottom sheet with alert details, mini map and "I'm on my way" response |
| **Alerts** | Safety timeline with summary stats, filters (All / Sent / Received), status chips and durations |
| **Contacts** | Emergency contacts, nearby responder map, search and call/message actions |
| **Profile** | Identity card, trust stats, protection toggles, emergency medical info, settings |

## Project structure

```
src/
├── App.svelte                  # app shell, view switching, SOS + toast orchestration
├── app.css                     # Tailwind theme, base styles, animations
├── main.js
└── lib/
    ├── data.js                 # mock user, responders, contacts, alert history
    └── components/
        ├── BottomNav.svelte    # floating nav with centered SOS button
        ├── SosButton.svelte    # hold-to-trigger button with progress ring
        ├── AlertFlow.svelte    # countdown → sending → active → safe
        ├── AlertIncoming.svelte# incoming SOS bottom sheet
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
- **Map** — pure SVG so the demo works offline and needs no Google Maps token. Swap `MapCard.svelte` for Leaflet/Google Maps when wiring the backend.

## Wiring the backend

The Go API in `../backend` exposes users, contacts and addresses. The screens currently use `src/lib/data.js`; replace those imports with API calls and keep the component props the same. The SOS flow is ready to be driven by real `TriggerSOS` / `UpdateLocation` events (WebSocket or FCM push).

> Demo data only. "Call 112" and messaging actions show a toast instead of placing a real call.
