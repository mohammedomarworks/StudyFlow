# StudyFlow Chrome Extension (v2.1.0)

A Manifest V3 Chrome extension companion for [StudyFlow](https://studyflow-productivity.netlify.app/).
It lives in the browser Side Panel and lets you sign in with your existing
StudyFlow account to view and manage **today's tasks and habits**, and jump
straight into a focus session — without leaving the page you're on.

The extension talks directly to the same Supabase backend as the web app
(v2.0), so data stays in sync across web and extension.

---

## Features

- **Manifest V3** service-worker architecture.
- **Toolbar action → Side Panel**: click the StudyFlow icon to open the panel.
- **Persistent authenticated Supabase session** (survives browser restarts via
  `chrome.storage.local`).
- **Signed-out state**: email/password sign-in plus a link to sign up on the web.
- **Signed-in state**:
  - Display name + email and a live cloud connection status badge.
  - Today's tasks with a progress bar.
  - Toggle task completion (optimistic UI with rollback on failure).
  - Quick add task (title, subject, priority, due date).
  - Delete task.
  - Today's habits with completion toggling.
  - **In-panel Focus timer** → run a real Pomodoro focus session inside the Side Panel (see below).
  - **Open StudyFlow** → opens the web app.
  - Sign out.
- **Right-click context menu**: on any normal web page, right-click to
  **StudyFlow → Save page as Note** or, over a text selection, **Save selected
  text as Note** (see below).
- **Realtime refresh**: subscribes to `tasks`, `habits`, and `habit_completions`
  changes for the signed-in user, so edits made on the web appear in the panel.
- **Offline handling**: detects offline state, shows an offline banner, disables
  writes, and restores data when the connection returns — no silent data loss.
- Light/dark theme toggle.

---

## Architecture

```
extension/
├── manifest.json              # MV3 manifest (action, side_panel, background, icons)
├── vite.config.js             # Build config; copies manifest + icons into dist/
├── generate-icons.js          # Dev script: regenerates PNG icons (no deps)
├── package.json
├── src/
│   ├── assets/icons/*.png      # 16 / 48 / 128 px icons
│   ├── background/
│   │   └── service-worker.js   # Opens side panel on action click
│   ├── shared/
│   │   ├── config.js           # Public Supabase URL + publishable key, app URLs
│   │   ├── supabase.js         # Bundled Supabase client + config validation guard
│   │   ├── auth.js             # signIn/signOut/getSession/getUser/onAuthStateChange
│   │   ├── api.js              # Tasks/habits/subjects/settings/study_sessions + realtime
│   │   └── focus-timer.js      # Pure, testable focus-timer state machine (no side effects)
│   └── sidepanel/
│       ├── sidepanel.html      # Panel markup (no inline scripts — CSP safe)
│       ├── sidepanel.css       # StudyFlow design system
│       └── sidepanel.js        # Panel controller (state, rendering, events)
└── tests/
    └── extension.test.js       # Node-based test suite (35 checks)
```

The Supabase JS SDK is **bundled locally** by Vite — no executable JavaScript is
loaded from a CDN, which keeps the extension compliant with the strict MV3
Content Security Policy.

---

## Installation (development / Load Unpacked)

```bash
cd extension
npm install
npm run build
```

Then in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked**.
4. Select the `extension/dist` folder.
5. Pin **StudyFlow** to the toolbar.
6. Click the StudyFlow toolbar icon → the Side Panel opens.
7. Sign in with your StudyFlow account.

To rebuild after changes, re-run `npm run build` and click the reload icon on
the extension card in `chrome://extensions`.

---

## Focus timer (in-panel)

The Focus card runs a real Pomodoro timer **inside the Side Panel** — it no
longer just opens the web timer in a new tab (the web timer at
`pages/timer.html` is unchanged and still works).

- **States:** READY (`25:00`, `▶ Start Focus`) → FOCUS (`⏸ Pause` / `⏹ Reset`)
  → PAUSED (`▶ Resume` / `⏹ Reset`) → completion ("Focus session complete",
  `Start Break`).
- **Timestamp-based countdown:** remaining time is always derived from an
  absolute `endTime` (`endTime - Date.now()`), never by decrementing a counter,
  so it stays accurate across Side Panel suspension. Pure state logic lives in
  [`src/shared/focus-timer.js`](src/shared/focus-timer.js) and is fully unit-tested.
- **Panel lifecycle:** minimal, non-sensitive timer state is stored in
  `chrome.storage.local` (key `studyflow_focus_timer`). On reopen the running
  session is restored and remaining time recomputed from timestamps. If it
  expired while the panel was closed, completion is processed **exactly once**.
- **Durations:** defaults Focus 25 / Short break 5 / Long break 15, editable in
  the card's "Timer settings" and stored extension-locally
  (`studyflow_focus_settings`). Compatible cloud Pomodoro settings are read as a
  seed where available; the extension **never overwrites** the web app's settings.
- **Cloud persistence:** a completed **focus** session is written to the shared
  Supabase `study_sessions` table via an idempotent upsert keyed on a
  client-generated UUID (`onConflict: 'id'`), matching the web app's
  `Store.saveSession` semantics — so reopen/reload/realtime can never create a
  duplicate row. Breaks are local only and never written.
- **Auth safety:** the timer state is tagged with its owning `userId`. Signing
  out cancels the timer and clears stored state; a state belonging to a
  different user is discarded on load — no session is ever written under the
  wrong account and no state leaks between users.
- **Offline:** the timer may run locally while offline. On an offline
  completion the panel shows *"Focus complete — session will need to be saved
  when you're online."* — it does **not** claim a cloud save succeeded, and
  there is no background sync queue (the web app owns durable offline writes).

---

## Context menu (Save page / selection as Note)

Right-clicking a normal web page shows a **StudyFlow** submenu with two items:

- **Save page as Note** (page context) — captures the page title and URL as a
  new note with content `Source: <url>` and a `web-clip` tag.
- **Save selected text as Note** (selection context) — captures the highlighted
  text plus the page title and URL, structured as
  `<selected text>\n\nSource:\n<title>\n<url>`.

Behavior and safety:

- **Menus** are created in the service worker with `chrome.contextMenus.create`
  and handled through a single `chrome.contextMenus.onClicked` listener (no
  inline `onclick` callbacks). The only new permission is `contextMenus`.
- **Untrusted input:** the page title, URL, and selected text are all treated as
  untrusted **plain text**. Payloads are plain strings — no HTML is built,
  injected, or parsed, and there are no `innerHTML`/`document.write` sinks. Pure,
  unit-tested helpers live in [`src/shared/context-menu.js`](src/shared/context-menu.js).
- **Note schema:** notes are written through the shared
  [`api.createNote`](src/shared/api.js) into the existing Supabase `notes` table
  (`title` / `content` / `subject_id` / `tags` / `pinned`). The schema has **no
  URL column**, so the source is encoded into `content`; no columns are invented.
  `user_id` is always taken from the authenticated session, never from input.
- **Subject assignment:** a captured note is created unassigned, then the web
  note page is opened (`pages/notes.html?noteId=<id>`) so the subject can be set
  there — the extension does not build an in-page modal.
- **Signed out:** no cloud write is attempted; the StudyFlow auth page
  (`pages/auth.html`) is opened instead.
- **Offline:** the write is blocked (consistent with the rest of the extension);
  the notes page is opened rather than pretending a note was saved. There is no
  new offline queue.
- **Safe URLs / no open redirect:** every tab the extension opens is validated
  with `URL()` and must be `https:` on the `studyflow-productivity.netlify.app`
  origin; `javascript:`, other hosts, and malformed URLs are rejected.
- **Duplicate protection:** an in-memory debounce (1.5 s, keyed on menu id + URL
  + selection) ignores duplicate click events from a single action, and
  `createNote` additionally supports an idempotent `onConflict: 'id'` upsert.
- **Page types:** works on normal `http(s)` pages; on `chrome://`, the Web Store,
  and extension pages the menu simply does nothing harmful.

---

Configuration lives in [`src/shared/config.js`](src/shared/config.js) and contains
**only public values**:

- `supabaseUrl` — the StudyFlow Supabase project URL.
- `supabasePublishableKey` — the **public / publishable** anon key. All access is
  enforced server-side by PostgreSQL Row Level Security (RLS).
- `appUrl` / `timerUrl` — production web app URLs.

`supabase.js` validates the config at client-creation time and **refuses** to
initialize if it detects a privileged service key or a JWT carrying a
`service_role` / `postgres` / `superuser` role.

> The extension does **not** use `js/supabase-config.local.js` from the web app,
> and it never contains secret keys, the service role key, the database password,
> or any refresh/access tokens.

---

## Permissions

The manifest requests the **minimum** permissions only:

| Permission  | Why |
|-------------|-----|
| `sidePanel` | Open and render the extension UI in the browser Side Panel. |
| `storage`   | Persist the Supabase auth session and the theme preference. |
| `contextMenus` | Add the StudyFlow right-click menu (Save page / selection as Note). |

No `tabs`, `history`, `bookmarks`, `activeTab`, `scripting`, `cookies`, or
`<all_urls>` host permissions are requested. Opening tabs uses
`chrome.tabs.create`, which does not require the `tabs` permission.

---

## Security

- Public publishable key only; secret/service keys are rejected at runtime.
- Supabase SDK bundled locally; no remote script execution.
- No inline scripts or inline event handlers (strict MV3 CSP compliant).
- All DOM built with safe APIs (`textContent`, `createElement`); no user content
  is injected via `innerHTML`.
- `user_id` is always derived from the authenticated session server-side and is
  never taken from UI input; RLS enforces per-user isolation.
- Writes are blocked while offline rather than silently dropped.

---

## Limitations

- Read/write requires connectivity; there is no full offline write queue (the web
  app owns that). Offline writes are blocked, not queued.
- Habit streak calculations are shown on the web app; the panel shows today's
  completion state only.
- Realtime uses a single channel per signed-in user and is torn down on sign-out.

---

## Testing

```bash
cd extension
npm test        # or: node tests/extension.test.js
```

The suite validates the manifest (V3, version 2.1.0, side panel, service worker),
required source files, minimal permissions, correct production URLs, required
API/auth functions, CSP compliance, icon integrity, a valid `dist/` build, that
no secret credentials are present, and the full Focus-timer state machine
(default state, start/pause/resume/reset, timestamp math, persistence &
restore-after-reopen, completion-exactly-once, session payload shape,
signed-out & account-switch safety, break isolation, and no per-second counter).
