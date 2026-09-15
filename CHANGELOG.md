# Changelog

All notable changes to this project are documented here. Format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.0.0] — 2026-09-15

### 🚀 Major Release: Cloud Synchronization, Auth, Realtime & Offline Resilience

StudyFlow v2.0.0 evolves the student productivity system into a dual-mode local-first and cloud-connected platform. It introduces seamless cloud synchronization powered by Supabase, secure user authentication, multi-device Realtime updates, offline write durability, and a full habit tracking suite—while guaranteeing 100% offline functionality, zero telemetry, and zero mandatory dependencies.

#### Added
- **⚡ Habits & Routines Tracking**:
  - Daily and weekday recurring habits tracking with target day configurations.
  - Interactive habit check-in buttons with immediate progress updates.
  - Current streak and longest streak calculations with completion history.
  - Dedicated habits page (`pages/habits.html`) and navigation link.
- **🔐 Cloud Foundation & Authentication (Phases A & B)**:
  - Robust 9-table PostgreSQL schema (`profiles`, `subjects`, `tasks`, `notes`, `habits`, `habit_completions`, `study_sessions`, `activity`, `settings`).
  - Strict Row Level Security (RLS) policies isolating user data by `(select auth.uid()) = user_id`.
  - Defense-in-depth PostgreSQL constraint triggers (`check_entity_ownership`) preventing cross-user foreign key references.
  - Supabase Auth integration supporting Sign Up, Sign In, Password Recovery, and Session Persistence.
  - Accessible navbar auth status chip with dynamic user avatar/initials and profile menu.
  - Dedicated authentication page (`pages/auth.html`) with client-side form validation.
- **🔄 Local-to-Cloud Migration & Cloud CRUD (Phase C)**:
  - Decoupled `RepositoryFactory` with `LocalRepository` and `CloudRepository` implementations.
  - User-controlled Migration Service (`js/migration.js`) with preview modal and deterministic UUID mapping.
  - Zero-data-loss guarantee (`LOGOUT != DELETE LOCAL DATA`): local `sp_*` storage is permanently preserved upon cloud sign-out.
  - Isolated cloud caches (`sp_cloud_${table}_${userId}`) to prevent cross-account cache contamination.
- **☁️ Multi-Device Realtime Sync & Conflict Handling (Phase D)**:
  - Live WebSocket synchronization across 7 entity tables via Supabase Realtime publication.
  - Deterministic Last-Writer-Wins (LWW) conflict resolution based on ISO timestamps.
  - Active form edit protection preventing open modals from being overwritten by remote events.
  - Realtime connection status indicators and zero feedback write loops.
- **📡 Offline Resilience & Cloud Write Queue (Phase E)**:
  - Durable FIFO queue (`sp_sync_queue_${userId}`) capturing mutations when network connectivity drops.
  - Optimistic cache mutations ensuring zero UI delay during offline operations.
  - Queue compaction coalescing multiple sequential updates and pruning un-synced create-delete pairs.
  - Exponential backoff retry with jitter (`1s` to `30s`) for transient failures.
  - Quarantining of permanent schema/RLS errors to prevent queue head-of-line blocking.
  - Dedicated Settings card with real-time sync queue badge and manual "Sync Now" trigger.
- **🛡️ Production Security & Reliability Hardening (Phase F)**:
  - Comprehensive automated test suite comprising 9 test files and 101 assertions.
  - Strict HTML entity and quote escaping via `App.escapeHtml()`.
  - Safe CSS color hex validator `Store._safeColor()` blocking stylesheet and script injections.
  - Safe redirect URL sanitizer `Auth.sanitizeRedirect()` blocking open redirects and directory traversal.
  - Safe JSON parse fallbacks across Local Storage, Cloud Cache, Migration Map, and Sync Queue.
  - High-volume stress testing (970+ entities) with sub-millisecond local reads and zero memory leaks.
  - Full production audit report documented in `docs/v2-release-audit.md`.
- **UI & Productivity Suite (v1.5 Baseline)**:
  - Urgency-driven Dashboard, Advanced Task Workflow, Interactive Academic Calendar, Deep Work Pomodoro Timer with Web Audio chimes, Progress Analytics, and Markdown Notes.
  - Global Search Command Palette (`Cmd+K` / `Ctrl+K`) across subjects, tasks, and notes.
  - Adaptive Dark, Light, and System themes with zero flash on load.

#### Changed
- Standardized navigation header and mobile drawer across all 11 HTML pages with active link indicators.
- Repository layer dynamically switches between Local and Cloud storage engines based on authentication state.
- Settings page enhanced with Cloud Account controls, Migration status, Realtime indicator, and Sync Queue controls.

#### Fixed
- Fixed bug in `js/storage.js` where `saveSubject`, `saveTask`, and `saveSession` dropped inserts when supplied with a new preserved ID.
- Fixed sample data reseeding on page reload after explicit workspace reset.
- Fixed XSS vectors in productivity insight renderings and redirect parameters.

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