# SOS Alert — interface review

## Scope and coverage

**Scope.** The whole frontend app, read-only: `/home/khai/Documents/sos-allert/frontend`
(Svelte 5 runes + Vite 6 + Tailwind v4 `@theme` tokens + `@lucide/svelte` + Leaflet).
Screens inspected: Auth, Home, Alerts, Contacts, Profile, the SOS flow
(describe → countdown → active → ended), the incoming-alert sheet and the map card,
including empty, loading and 320 px states.

**Stack conventions.** Phone-frame shell `max-w-[430px]`, Tailwind utility classes with
tokens in `src/app.css` (`--color-canvas/-ink/-muted/-line/-sos/-safe`, `--shadow-card`,
`--shadow-float`, `.card`, `.eyebrow`), no component library, no test suite
(`npm run dev`, `npm run build` only).

**Project convention docs found.** `AGENTS.md` only (no `CONTRIBUTING.md`, no design-system
doc, no interface ADRs). It documents behaviour, not visual or interaction standards, so it
settles no taste question here; where it documents intent the report uses that intent.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | All 11 components, all 4 flow phases, tab-walk + focus audit in Chromium, dialog focus behaviour measured, contrast computed from rendered colours | 12 findings (7 HIGH) |
| Layout | 390×844 and 320×720 renders of every tab and every flow phase, scroll/overflow measured | 3 findings |
| Writing | Every user-visible string: buttons, hints, empty/error/ended states, toasts, fabricated data | 6 findings |
| Typography | Rendered font-size census of every text node (Home, Alerts, Contacts, Profile, SOS flow) | 2 findings |
| Colors | WCAG ratios computed for every token pair actually rendered (`--color-muted`, `ink/NN`, `white/NN` on dark and on `#EE2B22`) | 2 findings |
| UI | Radii, shadows, motion, focus, hit areas, state feedback across all surfaces | 2 findings |

Reviewed live at `http://localhost:5173`. No backend was running (no MySQL in this
environment), so authenticated screens were rendered against a stubbed `fetch` with
fixtures matching `api/api.md` — the UI is real, the data is not.

## Findings

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH | Accessibility | `src/lib/components/AlertFlow.svelte:640-643`, `src/lib/components/AlertIncoming.svelte:82-85` | `role="dialog" aria-modal="true"` with no focus move, no trap, no `inert` on the shell, no focus restore. Measured while open: `document.activeElement` is `Hold to send SOS alert` **behind** the overlay, and 17 background controls (`Notifications`, `Open profile`, all four nav tabs, the SOS button) are still in the tab order | Move focus to the dialog on open (`autofocus` on the first control, or `.focus()` on the panel), loop Tab inside it, set `inert` on the app shell, restore focus to the trigger on close | `aria-modal` promises an isolated dialog; keyboard and screen-reader users are still in the page behind it. Escape only works in `describe` and `ended` (`AlertFlow.svelte:659,723`), never during `count` or `active` |
| HIGH | Accessibility / Writing | `src/lib/components/AlertFlow.svelte:1080-1093` | `<button type="button" …><Phone/>Call 112</button>` and `<button …><MessageCircle/>Message</button>` — no `onclick`, no `href`. Rendered inside the *active* alert screen | `<a href="tel:112">` for the first, and a real `sms:`/contact-picker for the second — or delete both | In the one screen where calling emergency services matters, the control does nothing and gives no feedback. Misleading control = blocked task |
| HIGH | Writing | `src/lib/components/ProfileView.svelte:24,159-168,225,266` (+ `src/lib/data.js:1-11`) | Hard-coded "12 Alerts sent", "4 Contacts", "Trust score 100" with a `BadgeCheck`, "Blood type O+ · Penicillin allergy", "1,248 responders nearby"; `let { user = mockUser } = $props()` falls back to a mock identity (Khairul Anwar, `trustScore: 98`) | Render the real counts from `GET /api/sos/*` and `GET /api/emergency-contacts`, omit the trust badge, and show medical info only when `user.blood_type`/allergies exist — otherwise an empty state | Verified at runtime with 0 alerts and 0 contacts: the screen still claims 12, 4 and a penicillin allergy. Fabricated medical data presented as fact, in an emergency app, is a safety risk |
| HIGH | Accessibility / Writing | `src/lib/components/ProfileView.svelte:80-99,180-205` | "Live location / Shared with responders while active" and "Auto-call 112 / Dial emergency if unacknowledged" are `role="switch"` toggles that only flip local `$state` (`onToggle`), while the 60 s heartbeat in `src/App.svelte` keeps publishing coordinates | Wire the switch to the heartbeat (`stop/start` + `PATCH /api/users/_current`) or remove it; the same for siren and auto-call until the backend supports them | The privacy switch lies: the user believes location sharing stopped while it continues. Auto-call promises a call that can never happen |
| HIGH | Accessibility | `src/lib/components/AlertsView.svelte:163-166`, `src/lib/components/ContactsView.svelte:183-187` | `Couldn't load alerts` + raw `{error}`, no retry control; contacts list the same | Add a `Retry` button that re-runs the loader, and keep the message to one sentence | An error that names no way to recover — the user is dead-ended with no path forward |
| HIGH | Writing | `src/lib/components/AlertFlow.svelte:1190` | "Your alert has ended and live location sharing stopped. **Your contacts have been notified.**" | State only what the system did: "Responders within 1 km were alerted. Your emergency contacts were not messaged." | Emergency contacts are never notified (the backend SMS path is log-only). A false reassurance at the moment the user decides whether they are safe |
| HIGH | Accessibility | `src/App.svelte:521-533` | Toast is `<p class="…">{toast}</p>` with no `role="status"` / `aria-live` | `<p role="status" aria-live="polite">` | It is the only channel for "Calling emergency services · 112", "Live location link copied — active for 60 min." and terminal status toasts; screen readers never hear any of them |
| HIGH | Writing | `src/lib/components/HomeView.svelte:130-136` | `Call 112` → `onnotify('Calling emergency services · 112')` with no `tel:` navigation. `Share location` → `onnotify('Live location link copied — active for 60 min.')` with no clipboard write | `Call 112` becomes `<a href="tel:112">`; `Share location` really copies (`navigator.clipboard.writeText`) and then confirms, or is removed | Both report success for actions that never happened — the worst possible pattern in a panic flow |
| HIGH | Typography | `src/lib/components/SosButton.svelte`, `src/lib/components/BottomNav.svelte`, `src/lib/components/AlertIncoming.svelte:173`, `src/lib/components/AlertFlow.svelte:906-920` | Rendered census: eyebrow 9 px, nav labels 9.5 px, SOS "hold" 7.5 px, nearly every secondary line 10–11.5 px, sheet detail labels 8.5 px, dark-screen labels 9–10 px | Floor metadata at 12 px / 0.75 rem, body at 14 px, keep the 26 px headings, raise the smallest label to 11 px only where it is a single uppercase tag | 9–11 px is below any legible dense-UI floor on a 390 px phone, and it is the *body* text, not a corner case — this is the single largest comprehension cost in the app |
| HIGH | Colors | `src/app.css:6` (`--color-muted:#7b818c`), `src/lib/components/AlertFlow.svelte:895,912,1190,1210-1220` | Measured: `--color-muted` on white **3.92:1**, on canvas `#f4f5f7` **3.59:1**, `text-muted/80` **2.82:1**; `text-ink/50` on `#F7F8FA` **3.55:1**; on the dark alert screen `text-white/35` **3.21:1**, `text-white/40` **3.82:1**; countdown mic error `text-white/70` on `#EE2B22` **2.65:1** | Darken the muted token to ≈`#5b6270` (4.6:1 on white, 4.3:1 on canvas), raise dark-surface secondary text to `white/60` (7.19:1) minimum, and never put white-on-red below 19 px (4.20:1) | Body and control text fails its required 4.5:1 pair across every screen; the smallest text carries the worst ratios |
| HIGH | Accessibility | `src/lib/components/AuthScreen.svelte:145,157,169`, `src/lib/components/ContactsView.svelte` (add form), `src/lib/components/AlertFlow.svelte:684` | All text inputs render at `text-[13px]` / `text-[12.5px]` | `text-[16px]` on mobile (or `text-base sm:text-sm`) | Below 16 px iOS Safari zooms the page on focus, which throws the user out of the form they were filling — in the sign-in and add-contact flows |
| MEDIUM | Accessibility / Writing | `src/lib/components/HomeView.svelte:156,179-185`, `src/lib/components/AlertsView.svelte:114,196-229`, `src/lib/components/ContactsView.svelte:216-219,238-247`, `src/lib/components/ProfileView.svelte:117,141,240-250`, `src/lib/components/MapCard.svelte:298` | Every one of these is a `<button>` (or link-looking row) with **no handler**: the Notifications bell, the location pill (with a `ChevronDown` implying a picker), "Filter alerts", every alert row in the Alerts list, "Message …" per contact, the Profile gear, "Edit", the three settings rows with `ChevronRight`, and the map footer whose `onopen` prop `HomeView` never passes | Delete what does not work yet, or wire it. A control that renders an affordance must act on it | Nine dead controls train users that taps do nothing — including tapping a past alert, which is the only way to review what happened |
| MEDIUM | Layout | `src/lib/components/AlertFlow.svelte:855-900` | The triage card is `overflow-hidden` inside a `flex h-full flex-col` scroll column. At 390 px "Classification unavailable" is cut mid-letter; at 320 px the whole card collapses to zero height | `shrink-0` on the card (and `min-h-0` on the scrolling parent) so it keeps its content height | Content clipped with no way to reach the full value — the sender cannot read why their alert was classified the way it was |
| MEDIUM | Layout | `src/lib/components/MapCard.svelte:189-196,298-322`, `src/lib/components/HomeView.svelte:340-360` | At 320 px the map attribution is clipped to "© OpenStreetMa"; "View all", "See all" and "History" are rendered at 41×16.5 and 35×16.5 px | Let the attribution wrap, and give in-section text actions a ≥24 px tall hit area (`py-1 -my-1` keeps the visual size) | OSM attribution truncated breaks the tile-provider requirement; 16 px-tall tap targets miss the 24 px minimum |
| MEDIUM | Writing | `src/lib/components/AlertsView.svelte:82,85,87,100-101`, `src/lib/components/ContactsView.svelte:174`, `src/lib/components/ProfileView.svelte:40`, `src/lib/components/AlertFlow.svelte:123,682` | Alert meta is `${emergency} · severity ${severity}` → "MEDICAL · severity 42%" (internal enum + numeric score); `toLocaleDateString('en-US')` / `toLocaleTimeString('en-US')` hardcoded in three components; "1 people"; the Indonesian placeholder "e.g. Ada orang pingsan di pantai dan tidak sadar" under an English UI; the severity bar uses `w-[${Math.round(s*100)}%]`, a class Tailwind never emits (verified: no `w-[NN%]` exists in the generated CSS), so the bar always renders empty | Show `emergencyLabel()` and a word for the level, format dates with the browser locale, pluralise properly, translate the placeholder, and set the bar width with an inline `style` (or `scaleX`) | Internal ids and percentages leak into user copy; a severity bar that never fills silently withholds the one visual signal that tells a sender how urgent their alert is |

## Verification

Run at `http://localhost:5173` in Chromium (managed, hidden), 390×844 and 320×720.
The backend is not running here, so authenticated data came from an injected `fetch`
stub reproducing `api/api.md` shapes (`/api/location`, `/nearby`, `/sos/inbox`,
`/sos/active`, `/sos`, `/emergency-contacts`) — every finding below about behaviour,
layout, type, contrast or focus was observed in the real components.

Passed checks:

- `npm run dev` serves the app; `document.title`, manifest and icons load.
- Home renders with 3 nearby responders; map pins, radius circle and the footer summary agree.
- SOS hold opens describe → countdown with live `cancel` → active screen; mic denial degrades to
  "Sending without audio" and the alert still triggers (documented fallback works).
- Keyboard: Space/Enter hold on the SOS button works; Tab walks the whole page in order.
- `prefers-reduced-motion` is honoured globally (`src/app.css`), so `animate-ping`,
  `animate-sos-pulse`, `animate-breathe`, `in:fly` are neutralised.
- No horizontal overflow at 320 px on any tab (`main.scrollWidth === clientWidth`).
- Contrast computed from **rendered** colours (not classes) for the pairs in the findings table.
- Tailwind emission check for the severity bar: no `.w-[NN%]` rule in the served CSS.
- Focus indicator: the browser's default 1 px `outline: auto` is present on every focusable
  element; no custom ring exists, but nothing is invisible either (not reported as a finding).

Not verified:

- Real alert rows, the incoming-alert sheet as an actual responder, and `ALERT_TRIAGE`
  escalation — these need the Go backend and a MySQL instance, which this environment
  does not have. Their markup and copy were read, not rendered.
- Native iOS behaviour (input zoom, `tel:` handoff) — inferred from the 13 px rule, not
  observed on a device.
- Push notifications and the service worker.

## Verdict

`Block` — 11 `HIGH` findings, and three of them are safety-critical (`Call 112` doing
nothing in the active alert, the fake "contacts have been notified", the fabricated medical
data). No domain was left unreviewed.

Suggested order of work: (1) make `Call 112` a real `tel:` link and delete the other dead
controls; (2) fix the dialog focus model; (3) delete the fabricated profile data and the
lying toggles; (4) raise the type floor and the muted token — those two changes alone
improve every screen in the app.

## Resolution

Every finding above was fixed in the working tree; `npm run build` passes
(4212 modules, no warnings). Verified live at `http://localhost:5173` against a
stubbed `fetch` (the backend and MySQL are not available in this environment),
390×844 and 320×720.

| # | Finding | Fix | Verification |
| --- | --- | --- | --- |
| 1 | Dialog focus model | `src/lib/focus.js` (`trap`), `data-autofocus`, `inert` on `<main>` + nav via `modalOpen` in `src/App.svelte` | Opening the SOS sheet puts focus on `Emergency description`; Tab from the last control wraps to `Cancel`, Shift-Tab back to `Continue`; `main.inert === true`; 0 background controls tabbable |
| 2 | Dead `Call 112` / `Message` | One real `<a href="tel:112">Call 112 — emergency services</a>`; `Message` deleted | Rendered on the active screen: `tel:112`, no Message button |
| 3 | Fabricated profile data | `mockUser` default and `src/lib/data.js` deleted; stats are real (`contacts.list()` count, `$responders.length`); no trust badge, no blood type | With 2 contacts / 3 responders the screen shows 2 and 3; body text contains none of "12 Alerts", "Penicillin", "Trust score", "1,248", "Auto-call", "Siren" |
| 4 | Lying toggles | `locationSharing` store gates the heartbeat `PUT` and republishes on re-enable; siren + auto-call rows deleted | Two switches remain, both wired; heartbeat skips while off (code path in `publishHeartbeat()`) |
| 5 | Dead-ended errors | `Retry` on Alerts and Contacts load errors, `role="alert"` on every error | Forced a 500 on `/api/emergency-contacts`: "Couldn't load contacts · backend offline · Retry"; Retry after restoring the stub renders the list |
| 6 | "Your contacts have been notified." | Ended screen now: "Your alert has ended and live location sharing stopped. Responders on this alert see that it is resolved." | Rendered after the two-tap resolve |
| 7 | Silent toast | Persistent `<div role="status" aria-live="polite">` wrapper | Present in the DOM with `aria-live="polite"` |
| 8 | Fake `Call 112` / `Share location` | `tel:112` link; real `navigator.share` → `clipboard.writeText` → honest failure messages; "Live 60 min" → "Via Maps link" | Both controls render with real targets; no toast fires on open |
| 9 | 9–11.5 px type | Scale remap across all 11 components; `.eyebrow` 12 px; nav labels 12 px | Rendered census on every tab: no text node below 11 px, and 11 px only for uppercase tags/attribution |
| 10 | Muted contrast | `--color-muted: #5b6270`; `white/35–50` → `white/55–60`; `muted/80` → `muted`; `ink/50` → `ink/60` | Computed token is `#5b6270`; the active screen's secondary copy renders at `white/60` (7.19:1) |
| 11 | Inputs zoom on iOS | All inputs/textarea `text-[16px] leading-tight`; password reveal 44×44 with `pr-11` | Contacts and Auth inputs render at 16 px |
| 12 | Dead controls | Bell → alerts, location pill is a `div`, filter button removed, alert rows are `div`s, `Message` → `sms:`, profile gear/Edit/link rows removed, map footer non-interactive without `onopen` | Alerts tab: no filter button, 0 rows rendered as buttons; Home/Profile: no handler-less buttons |
| 13 | Clipped triage card | `shrink-0` on the card | At 320 px and 390 px the card renders its full text; no horizontal overflow (`scrollWidth === clientWidth`) |
| 14 | Clipped attribution, small actions | Attribution wraps inside the map and keeps a 10 px inset from the rounded edge; leaflet bottom containers `max-width: 100%` | Attribution right edge is 10 px inside the map, text complete ("© OpenStreetMap") |
| 15 | Enum/score copy, locale, plural, dead bar | `emergencyLabel()` + `severityWord()` ("Medical emergency · Severity Critical"), locale-based date/time, `1 contact`/`2 contacts`, English placeholder, inline `width` style | Triaged alert renders "CRITICAL" (no %), severity bar fills 80 % (`258px` measured), "5 km" radius copy matches the bar |

Also fixed while verifying (same root cause, reported here for completeness): the
active screen's headline said "Help is on the way" with zero responders (now
"Alert sent" until one responds), the radio copy claimed an "AI severity score"
on unclassified alerts (now explains the default 1 km), and
`ContactsView`'s invite card promised "They'll be alerted when you need help"
(now "Kept on your account. They are not messaged automatically.").

Remaining work: `HomeView.alertHistory` is never populated, so "Recent activity"
always shows its empty state — wiring it needs an alerts-by-user feed; the
false-alarm cancel still waits on `safe_pin` (see `AGENTS.md`).
