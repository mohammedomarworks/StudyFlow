# StudyFlow — Study Planner

A complete, responsive study planner built with **HTML5, CSS3, and Vanilla JavaScript** —
no frameworks, no build step. All data is stored locally in the browser via **Local Storage**,
so it works fully offline and keeps your data private.

![Made with HTML5 · CSS3 · Vanilla JS](https://img.shields.io/badge/stack-HTML5%20·%20CSS3%20·%20Vanilla%20JS-7c3aed)

## ✨ Features

- **Dashboard** — time-based greeting, study statistics, an animated completion ring,
  today's tasks (with inline complete), upcoming exams with countdowns, and a daily quote.
- **Tasks** — full CRUD: Add, Edit, Delete, Complete, plus **Search**, **Filter by subject**,
  **Filter by status**, **Sort by due date / priority**, and **form validation**.
- **Subjects** — organize courses with a color, teacher and exam date; live task counts and progress.
- **Calendar** — monthly grid plotting tasks (in the subject's color) and exams (red), with
  month navigation and a per-day detail view.
- **Progress** — overall ring, summary tiles, per-subject progress bars, and priority breakdown.
- **Notes** — searchable study notes linked to subjects.
- **About** — a live data snapshot, feature overview, and a "reset all data" utility.
- **Dark / Light mode** — persisted to Local Storage, respects your OS preference, no flash on load.
- **Responsive** — Flexbox + CSS Grid layouts with a mobile hamburger navbar.
- Smooth animations, hover effects, toasts, and reusable modal/confirm dialogs.

## 📁 Project structure

```
Study Planner/
├── index.html              # Dashboard (entry point)
├── pages/                  # The other six pages
│   ├── subjects.html
│   ├── tasks.html
│   ├── calendar.html
│   ├── progress.html
│   ├── notes.html
│   └── about.html
├── css/
│   ├── variables.css       # Design tokens + light/dark themes
│   ├── base.css            # Reset, typography, animations, utilities
│   ├── components.css      # Navbar, buttons, cards, forms, modals, toasts
│   ├── pages.css           # Per-page layouts (dashboard, calendar, rings…)
│   └── responsive.css      # Breakpoints (Flexbox/Grid)
└── js/
    ├── storage.js          # Local Storage data layer + date utils + seed data
    ├── app.js              # Shared shell: theme, navbar, toast, modal, quotes
    ├── dashboard.js
    ├── tasks.js
    ├── subjects.js
    ├── calendar.js
    ├── progress.js
    ├── notes.js
    └── about.js
```

## 🚀 Running it

It's a static site — no dependencies. Either:

- **Double-click `index.html`** to open it directly in your browser, or
- Serve the folder for a proper `http://` origin:

```bash
python3 -m http.server 8000
```

Then visit <http://localhost:8000>.

On first launch the app seeds a few example subjects, tasks and notes so you can see it in
action. Use **About → Reset all data** to clear everything and start fresh.

## 🗃️ Data model (Local Storage keys)

| Key            | Contents                                                        |
| -------------- | --------------------------------------------------------------- |
| `sp_subjects`  | `{ id, name, color, teacher, examDate }`                        |
| `sp_tasks`     | `{ id, title, subjectId, dueDate, priority, notes, completed }` |
| `sp_notes`     | `{ id, title, subjectId, content, createdAt, updatedAt }`       |
| `sp_settings`  | `{ theme }`                                                     |

All statistics (progress, countdowns, overdue detection) are **derived** from this data, so
every page stays consistent automatically.
