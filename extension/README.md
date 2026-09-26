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
  - **Start Focus** → opens the web timer.
  - **Open StudyFlow** → opens the web app.
  - Sign out.
- **Realtime refresh**: subscribes to `tasks`, `habits`, and `habit_completions`
  changes for the signed-in user, so edits made on the web appear in the panel.
- **Offline handling**: detects offline state, shows an offline banner, disables
  writes, and restores data when the connection returns — no silent data loss.
- Light/dark theme toggle.

Deliberately **out of scope** for v2.1.0 (planned for later): context menu,
save webpage / selected text, and new-tab replacement.

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
│   │   └── api.js              # Tasks/habits/subjects/settings queries + realtime
│   └── sidepanel/
│       ├── sidepanel.html      # Panel markup (no inline scripts — CSP safe)
│       ├── sidepanel.css       # StudyFlow design system
│       └── sidepanel.js        # Panel controller (state, rendering, events)
└── tests/
    └── extension.test.js       # Node-based test suite (20 checks)
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

## Supabase configuration

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

No `tabs`, `history`, `bookmarks`, `activeTab`, `scripting`, `cookies`, or
`<all_urls>` host permissions are requested.

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
API/auth functions, CSP compliance, icon integrity, a valid `dist/` build, and
that no secret credentials are present.
