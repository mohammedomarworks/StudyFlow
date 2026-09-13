# Changelog

All notable changes to this project are documented here. Format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.0.0] — 2026-09-13

### 🚀 Major Overhaul & Production Release

StudyFlow v2.0.0 transforms the original academic prototype into a production-grade, local-first student productivity system with zero external runtime dependencies, full privacy preservation, and a polished design system.

#### Added
- **Dashboard & Urgency Hub (Phase 1)**:
  - Real-time study pulse: Today's Priorities, Next 7-Day Deadlines, Overdue warnings, and Exam countdowns.
  - Subject completion progress bars and recent activity audit timeline.
  - Quick task capture modal accessible from anywhere on the dashboard.
- **Enhanced Task System (Phase 2)**:
  - Task categories: `Assignments`, `Reading`, `Revision`, `Practice`, `Project`, and `Other`.
  - Priority levels (`High`, `Medium`, `Low`) with visual badges and urgency sorting.
  - Estimated duration tracking (in minutes) with visual duration tags.
  - Multi-criteria sort options: Due Date, Priority, Title, and Estimated Time.
  - Immediate inline checkbox toggling for task completion without full modal editing.
  - Configurable deletion confirmation safeguard to prevent accidental data loss.
- **Interactive Academic Calendar (Phase 3)**:
  - Dynamic month grid with responsive day cells, task completion pills, and color-coded exam markers.
  - Interactive Day Detail inspector drawer with one-click inline task completion toggles.
  - Workload indicator badges highlighting busy study days.
- **Deep Work Focus Timer (Phase 4)**:
  - Pomodoro timer state machine supporting Focus (25m), Short Break (5m), and Long Break (15m) presets.
  - Web Audio API sound synthesis generating gentle multi-frequency chime alerts with zero external audio assets.
  - Subject linkage to attribute focused time directly to courses.
  - Automatic focus session history logging and streak aggregation.
- **Progress & Analytical Insights (Phase 5)**:
  - Visual completion ratios per subject and overall academic workload.
  - Focus streak counter and daily study velocity tracking.
  - Productivity insights engine calculating completion velocity and study distribution.
  - Chronological activity log recording key actions across all pages.
- **Notes & Knowledge Base (Phase 6)**:
  - Markdown-enabled study notes editor with live preview.
  - Favorite note pinning to keep high-priority study materials at the top.
  - Course and subject tagging for grouped revision.
  - Instant keyword filtering and real-time note search.
- **Settings, Data Safety & Personalization (Phase 7)**:
  - Reorganized 6-section settings layout: App Preferences, Daily Focus Goals, Storage Diagnostics, Backup & Restore, Dangerous Actions, and About.
  - Non-destructive pre-import JSON backup validation checking structure, timestamps, and schema integrity.
  - Interactive Side-by-Side Import Preview comparison modal displaying incoming versus current records before restoring.
  - Real-time storage diagnostics displaying estimated byte usage and entity count breakdown.
  - Configurable daily focus goal presets (60m, 90m, 120m, 180m, 240m) and custom minute inputs with dynamic duration formatting.
  - Application preferences: Default task sort order, deletion confirmation toggle, and explicit reduced motion preference.
  - Non-reseeding workspace reset guarantee (`Store.clearAll()` preserves `sp_seeded_v1 = '1'`).
- **Final Release Hardening & Quality Pass (Phase 8)**:
  - Comprehensive automated navigation audit: verified 100% link symmetry across all 9 HTML pages.
  - Security audit: audited all dynamic HTML injections; resolved unescaped item titles with `App.escapeHtml()`.
  - Standardized version numbering across `js/storage.js`, `pages/about.html`, and documentation.
  - Fully rewritten and accurate `README.md` and updated `DESIGN_SYSTEM.md`.

#### Changed
- Standardized navigation bar across all 9 pages (`index.html`, `tasks.html`, `subjects.html`, `calendar.html`, `timer.html`, `progress.html`, `notes.html`, `settings.html`, `about.html`).
- Standardized unified brand mark, SVG iconography, and responsive mobile navigation drawer.
- Theme engine now provides seamless transition across Dark, Light, and System modes with zero flash of unstyled content (FOUC).

#### Fixed
- Fixed unescaped string interpolation in `js/progress.js:renderProductivityInsights` to prevent XSS.
- Fixed sample data reseeding on page reload after explicit workspace clearing.
- Fixed stale documentation referencing obsolete external quote API endpoints.

---

# v1.0.0 — Initial Release
Released: August 2026

## Features

- Dashboard
- Tasks
- Subjects
- Calendar
- Notes
- Progress
- About Page

## Implemented

- Local Storage
- Dark Mode
- Search
- Task CRUD
- Responsive Layout
- CSS Variables
- CSS Grid
- Flexbox

## Status

Stable

This version represents the original academic submission before the project was redesigned into a production-ready application.