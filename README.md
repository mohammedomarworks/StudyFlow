# 📚 StudyFlow

<p align="center">
  A modern, responsive, distraction-free student productivity and study planning system built with <b>pure HTML, CSS, and vanilla JavaScript</b>.
  <br />
  Organize subjects, manage tasks with time estimates, schedule via interactive calendar, run Pomodoro focus sessions, capture notes, and track your momentum—<b>100% locally and privately in your browser</b>.
</p>

<p align="center">
  <a href="https://mohammedomarworks.github.io/StudyFlow/">
    <img src="https://img.shields.io/badge/Live_Demo-Visit_StudyFlow-8B5CF6?style=for-the-badge" alt="Live Demo">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-success?style=for-the-badge" alt="License MIT">
  </a>
  <img src="https://img.shields.io/badge/Version-v2.0.0-blueviolet?style=for-the-badge" alt="Version 2.0.0">
  <img src="https://img.shields.io/badge/Dependencies-Zero-emerald?style=for-the-badge" alt="Zero Dependencies">
</p>

---

> **StudyFlow v2.0 Release Ready**: StudyFlow v2.0 brings optional, secure cloud synchronization, user authentication, multi-device realtime sync, and offline write resilience powered by Supabase—while strictly preserving the fast, zero-dependency, local-first architecture. All user data remains 100% functional offline without an account. See [`docs/v2-architecture.md`](docs/v2-architecture.md) and [`docs/v2-release-audit.md`](docs/v2-release-audit.md) for complete architectural specifications and audit reports.

---

## ✨ Features Overview

StudyFlow provides an integrated suite of student productivity tools designed to eliminate study friction:

- **🏠 Dynamic Dashboard**: Instant pulse on today's priorities, urgent tasks, upcoming 7-day deadlines, exam countdowns, subject completion bars, and quick capture modals.
- **📋 Enhanced Tasks**: Comprehensive task management with functional categories (*Assignments, Reading, Revision, Practice, Project, Other*), priority tiers (*High, Medium, Low*), time estimates, due dates, multi-criteria sorting, quick-completion toggles, and safe deletion confirmation.
- **📚 Subjects Management**: Color-coded academic subjects with syllabus codes, target exams, associated tasks, and progress tracking.
- **⚡ Habits & Routines**: Build consistent study routines with daily and weekday frequency targets, visual streak tracking, completion heatmaps, and one-click check-ins.
- **📅 Interactive Study Calendar**: Month-view academic schedule with color-coded exam markers, task due indicators, completion badges, and interactive day detail inspection drawer.
- **⏱️ Focus & Pomodoro Timer**: Dedicated deep work timer with Pomodoro (25m), Short Break (5m), and Long Break (15m) modes, custom Web Audio synthesis chimes, subject linking, and auto-logged focus history.
- **📊 Progress & Analytics**: Visual completion ratios, priority breakdowns, focus velocity streaks, habit trends, and chronological activity feed.
- **📝 Notes & Knowledge Base**: Markdown-enabled study notes, subject linking, favorite pinning, and rapid search filtering.
- **🔐 Authentication & Accounts (Optional)**: Privacy-preserving authentication via Supabase Auth with secure session management, navbar user chip, and account profile controls.
- **☁️ Realtime Cloud Synchronization**: Instant multi-tab and multi-device live data synchronization with conflict handling via Last-Writer-Wins (LWW) and active form protection.
- **📡 Offline Resilience & Write Queue**: Optimistic UI updates with durable FIFO write queuing, exponential backoff retries, and compaction to guarantee zero data loss during network disruptions.
- **🔄 Local-to-Cloud Migration**: Seamless one-click migration of offline browser data to cloud accounts with interactive preview and zero data loss on logout.
- **⚙️ Settings & Data Control**: In-memory storage diagnostics, safe pre-import validation, side-by-side JSON preview comparison modal, customizable daily focus goals, app preferences (default sorting, confirm delete, reduced motion), non-reseeding reset, and exportable JSON backups.
- **🔍 Global Search (`Cmd+K` / `Ctrl+K`)**: Fast universal command palette searching across tasks, subjects, and notes with instant keyboard navigation.
- **🌓 Adaptive Theme**: Seamless Dark, Light, and System theme synchronization with persistent preferences and zero flash on load.
- **🔒 100% Local-First & Private by Default**: Fully functional without an account or internet connection—all data resides safely in browser `localStorage`.

---

## 🛠️ Tech Stack

| Technology | Implementation & Purpose |
|------------|---------------------------|
| **HTML5** | Semantic markup across 11 distinct pages with accessibility attributes (`aria-*`, landmark roles) |
| **CSS3** | Modern custom properties (design tokens), responsive CSS Grid, Flexbox, and fluid typography |
| **Vanilla JavaScript (ES6+)** | Modular application architecture, event delegation, and reactive DOM rendering without frameworks |
| **Web Storage API** | Browser `localStorage` engine with schema migrations, validation, and diagnostics |
| **Web Audio API** | Synthesized chime frequencies for focus timer alerts without external audio assets |
| **Supabase (Optional)** | PostgreSQL, Row Level Security (RLS), Auth, Realtime WebSockets, and PostgREST client |
| **Zero Build Steps / Zero Bundlers** | Pure native web standards—runs directly in modern browsers or static hosting |

---

## 📁 Project Structure

```text
StudyFlow/
├── index.html                   # Main Dashboard
├── pages/
│   ├── auth.html                # Account Sign In, Sign Up & Password Recovery
│   ├── tasks.html               # Task Management
│   ├── subjects.html            # Subject Directory & Syllabi
│   ├── habits.html              # Daily & Weekday Habits Tracker
│   ├── calendar.html            # Academic Calendar & Day Inspector
│   ├── timer.html               # Focus & Pomodoro Timer
│   ├── progress.html            # Analytics, Velocity & Activity Log
│   ├── notes.html               # Notes & Knowledge Management
│   ├── settings.html            # Preferences, Backup, Migration & Sync Queue
│   └── about.html               # Architecture, Live Stats & Badges
├── css/
│   ├── variables.css            # Design tokens, color palettes & spacing
│   ├── base.css                 # Reset, typography, utility classes & reduced-motion
│   ├── components.css           # Buttons, cards, modals, badges & form controls
│   ├── pages.css                # Page-specific layout rules & widget grids
│   └── responsive.css           # Tablet and mobile viewport breakpoints
├── js/
│   ├── storage.js               # Store API, LocalStorage engine, validation & diagnostics
│   ├── app.js                   # Navigation, theme toggle, Cmd+K modal & shared helpers
│   ├── auth.js                  # Supabase Auth controller, session state & navbar chip
│   ├── auth-page.js             # Auth UI forms, validation & password recovery
│   ├── repository.js            # Base, Local & Cloud Repository boundary & mapper
│   ├── migration.js             # Local-to-cloud migration service with UUID mapping
│   ├── realtime.js              # Realtime WebSocket manager & LWW conflict handler
│   ├── sync-queue.js            # Offline resilient write queue with FIFO replay
│   ├── supabase.js              # Supabase client initializer & security validator
│   ├── supabase-config.js       # Public Supabase project configuration
│   ├── dashboard.js             # Dashboard widgets, urgent queues & exam countdowns
│   ├── tasks.js                 # Task filtering, sorting, CRUD & inline completion
│   ├── subjects.js              # Subject management & exam scheduling
│   ├── habits.js                # Habit tracker UI, streaks & completions
│   ├── calendar.js              # Month rendering, day inspection & event markers
│   ├── timer.js                 # Pomodoro state machine & Web Audio chimes
│   ├── progress.js              # Completion metrics, chart calculations & streak logic
│   ├── notes.js                 # Note editor, markdown renderer, pinning & subject filter
│   ├── settings.js              # Settings controller, import preview & sync diagnostics
│   └── about.js                 # Live database snapshot statistics
├── supabase/
│   ├── migrations/
│   │   ├── 0001_initial_schema.sql         # 9 tables, RLS policies, ownership triggers
│   │   └── 0002_realtime_publication.sql  # Supabase Realtime publication setup
│   └── tests/
│       └── 0001_rls_and_schema.test.sql    # pgTAP database-level RLS test suite
├── tests/                       # Automated Node.js test suites (9 suites, 101 tests)
├── assets/
│   └── screenshots/             # Interface preview screenshots
├── docs/
│   ├── v2-architecture.md       # Architectural specifications & design patterns
│   └── v2-release-audit.md      # Production audit report & release readiness sign-off
├── DESIGN_SYSTEM.md             # Color tokens, typography, and component specifications
├── CHANGELOG.md                 # Project version history and release notes
├── LICENSE                      # MIT Open Source License
└── README.md                    # Project documentation
```

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Scope | Action |
|----------|-------|--------|
| <kbd>Cmd</kbd> + <kbd>K</kbd> / <kbd>Ctrl</kbd> + <kbd>K</kbd> | Global | Open Global Search command palette |
| <kbd>Esc</kbd> | Global | Dismiss active modal, search palette, or day drawer |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Search / Lists | Navigate search results and interactive lists |
| <kbd>Enter</kbd> | Search / Modals | Jump to selected search result or submit active form |

---

## 💾 Local-First Storage & Data Safety

StudyFlow is built entirely around an offline, privacy-first local storage architecture:

- **Namespaced Storage Keys**:
  - `sp_subjects` — Registered courses, syllabus codes, and exam dates
  - `sp_tasks` — Tasks with categories, priorities, due dates, and time estimates
  - `sp_notes` — Study notes with markdown content, pinning, and subject links
  - `sp_sessions` — Completed focus sessions and deep work history
  - `sp_activity` — Chronological activity feed
  - `sp_settings` — Theme preferences, daily focus goal targets, and app options
  - `sp_seeded_v1` — First-run sample data flag
- **JSON Backup & Restore**: Export a timestamped, formatted JSON backup of your entire workspace at any time.
- **Pre-Import Validation & Preview**: Before importing, the file is validated non-destructively for JSON and schema structure, presenting a side-by-side comparison modal with incoming vs. current counts.
- **Anti-Reseeding Guarantee**: Clearing data removes all user records while safely maintaining the seeded flag, ensuring an emptied workspace remains completely empty on page reload.

---

## 🚀 Getting Started

No build tools, compilation, or package managers are required.

### 1. Clone the Repository

```bash
git clone https://github.com/mohammedomarworks/StudyFlow.git
cd StudyFlow
```

### 2. Launch in Browser

Choose any static file server:

**Option A: Python 3**
```bash
python3 -m http.server 8000
```
Then open `http://localhost:8000` in your browser.

**Option B: VS Code Live Server**
Right-click `index.html` and select **"Open with Live Server"**.

**Option C: Direct Browser Opening**
Double-click `index.html` to open directly in Google Chrome, Safari, Firefox, or Edge.

---

## 📸 Screenshots

### 🏠 Dashboard

The StudyFlow dashboard provides an overview of tasks, completed work, upcoming exams, and overall study progress.

<p align="center">
  <img src="assets/screenshots/dashboard.png" alt="StudyFlow Dashboard" width="900">
</p>

---

### 📋 Tasks

Manage academic tasks by adding, editing, completing, and deleting tasks.

<p align="center">
  <img src="assets/screenshots/tasks.png" alt="StudyFlow Tasks" width="900">
</p>

---

### 📚 Subjects

Organize different academic subjects and keep track of subject-related information.

<p align="center">
  <img src="assets/screenshots/subjects.png" alt="StudyFlow Subjects" width="900">
</p>

---

### 📅 Calendar

View important academic dates, tasks, and upcoming examinations through the study calendar.

<p align="center">
  <img src="assets/screenshots/calendar.png" alt="StudyFlow Calendar" width="900">
</p>

---

### 📝 Notes

Create and manage study notes in one centralized place.

<p align="center">
  <img src="assets/screenshots/notes.png" alt="StudyFlow Notes" width="900">
</p>

---

### 📊 Progress

Monitor academic progress and task completion through visual statistics.

<p align="center">
  <img src="assets/screenshots/progress.png" alt="StudyFlow Progress" width="900">
</p>

---

### ℹ️ About

Learn more about StudyFlow and its purpose as a student productivity application.

<p align="center">
  <img src="assets/screenshots/about.png" alt="StudyFlow About" width="900">
</p>

## 🌐 Live Demo

🚀 **[Visit StudyFlow](https://mohammedomarworks.github.io/StudyFlow/)**


---

## 🚀 Roadmap & Release Milestones

### Version 1.0.0 — Foundation ✅
- [x] Semantic HTML page layouts
- [x] Basic task and subject management
- [x] Basic monthly calendar
- [x] Simple notes and study progress
- [x] Initial dark mode theme
- [x] Basic LocalStorage persistence

### Version 2.0.0 — Production Release ✅
- [x] **Full UI/UX Redesign**: High-contrast modern dark & light themes, Plus Jakarta Sans typography, and accessible design tokens across 11 pages.
- [x] **Urgency-Driven Dashboard**: Today's priorities, 7-day deadlines, exam countdowns, subject velocity meters, and quick task modal.
- [x] **Advanced Task Workflow**: Categories (*Assignments, Reading, Revision, etc.*), time estimates, priorities, multi-criteria sorting, inline completion, and delete safeguards.
- [x] **⚡ Habits Tracker**: Daily and weekday recurring habits tracker with streak calculations, completion heatmaps, and quick toggle buttons.
- [x] **Interactive Academic Calendar**: Color-coded exam markers, task indicators, day drawer inspection, and inline task toggles.
- [x] **Deep Work Pomodoro Timer**: Focus (25m), Short Break (5m), Long Break (15m), Web Audio chimes, and automatic subject-linked session logging.
- [x] **Progress & Velocity Analytics**: Subject completion ratios, daily study streaks, focus analytics, and chronological activity feed.
- [x] **Notes & Knowledge Base**: Markdown editor, note pinning, subject filtering, and fast keyword search.
- [x] **🔐 Supabase Cloud Foundation & Auth**: PostgreSQL 9-table schema with strict RLS, cross-user triggers, session management, and navbar auth chip.
- [x] **☁️ Realtime Cloud Synchronization**: Instant multi-tab and multi-device live data synchronization with conflict handling via Last-Writer-Wins (LWW) and active form protection.
- [x] **📡 Offline Resilience & Write Queue**: Optimistic UI updates with durable FIFO write queuing, exponential backoff retries, and offline compaction.
- [x] **🔄 Local-to-Cloud Migration**: Seamless one-click migration of offline browser data to cloud accounts with zero data loss on logout.
- [x] **Settings & Data Protection**: Pre-import validation, side-by-side JSON comparison modal, in-memory diagnostics, daily focus goal targets, and anti-reseeding workspace reset.
- [x] **Global Command Palette (`Cmd+K`)**: Unified cross-entity search with keyboard navigation.
- [x] **Accessibility & Performance**: 100% clean navigation links, safe HTML escaping, reduced-motion preferences, and zero runtime dependencies.

### Future Explorations
- [ ] iCalendar / `.ics` export for study schedule integration
- [ ] Tabular CSV export for tasks and session logs
- [ ] Flashcard study mode linked to subject notes

---

## 🤝 Contributing

Contributions, suggestions, and feedback are welcome. Feel free to fork the repository and submit a pull request.

---

## 📄 License

This project is licensed under the MIT License.

---

## 👨‍💻 Author

**Mohammed Omar**

GitHub: https://github.com/mohammedomarworks

---

⭐ If you like this project, consider giving it a star!