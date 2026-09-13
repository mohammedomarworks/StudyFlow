# StudyFlow Design System

This document defines the visual design rules for StudyFlow.

The goal is to make StudyFlow feel like a polished, modern student productivity application rather than a basic academic assignment project.

---

## 1. Design Philosophy

StudyFlow should feel:

- Modern
- Clean
- Focused
- Academic
- Calm
- Motivating
- Easy to scan
- Consistent across every page

The interface should prioritize the student's most important information first.

A student should be able to understand what needs attention within a few seconds.

---

## 2. Visual Style

StudyFlow uses a modern, productivity-focused interface with a signature purple accent system, fully supporting Light, Dark, and System theme modes.

### Main Characteristics

- Adaptive theme (Dark, Light, System) via CSS custom properties
- StudyFlow purple primary accent (`#8B5CF6`)
- Soft card surfaces with subtle translucent borders
- Rounded corners (`8px` to `16px`)
- Soft shadows and accent glows
- Strict typographic hierarchy (`Plus Jakarta Sans` with monospace data badges)
- Minimal visual clutter and generous breathing room
- Consistent 4px-based spacing scale
- Reduced motion support (`prefers-reduced-motion` and user toggle)

The design avoids excessive decoration and unnecessary animations, keeping focus on academic execution.

---

## 3. Color & Theme System

StudyFlow implements design tokens through CSS custom variables declared in `css/variables.css`.

### Theme Palettes

| Token | Dark Theme (Default) | Light Theme |
|---|---|---|
| `--bg` | `#0B0D13` | `#F8F9FD` |
| `--surface` | `#131620` | `#FFFFFF` |
| `--surface-2` | `#1A1D2B` | `#F0F2F9` |
| `--surface-3` | `#222638` | `#E5E8F3` |
| `--border` | `rgba(255, 255, 255, 0.08)` | `rgba(0, 0, 0, 0.08)` |
| `--text` | `#F3F4F6` | `#111827` |
| `--text-muted` | `#9CA3AF` | `#6B7280` |

### Accent Colors

- **Primary Purple:** `#8B5CF6` (`--primary`)
- **Hover Purple:** `#7C3AED` (`--primary-hover`)
- **Purple Glow:** `rgba(139, 92, 246, 0.25)`

### Status & Priority Colors

- **Success / Low Priority / Completed:** `#10B981` (`--green`)
- **Warning / Medium Priority / Due Soon:** `#F59E0B` (`--orange` / `--amber`)
- **Danger / High Priority / Overdue:** `#EF4444` (`--red`)
- **Info / Study Sessions:** `#3B82F6` (`--blue`)
- **Notes / Accents:** `#EC4899` (`--pink`)

---

## 4. Typography

StudyFlow should use a clean modern sans-serif font.

Heading Hierarchy

Page title:

Large
Bold
High contrast

Section heading:

Medium-large
Semi-bold

Card title:

Medium
Semi-bold

Body text:

Regular
Comfortable line height

Supporting text:

Smaller
Muted color

Typography should create a clear visual hierarchy without making the interface feel crowded.

5. Spacing

Use consistent spacing throughout the application.

Preferred spacing scale:

4px
8px
12px
16px
20px
24px
32px
40px
48px

Avoid random spacing values when an existing spacing value can be reused.

6. Border Radius

StudyFlow uses soft rounded corners.

Small elements
8px
Buttons and inputs
10px - 12px
Cards
14px - 16px
Large hero sections
18px - 20px

The same radius system should be reused across the application.

7. Cards

Cards are an important part of the StudyFlow interface.

Cards should have:

Dark surface
Subtle border
Rounded corners
Comfortable internal padding
Clear hierarchy
Optional soft shadow

Cards should not look completely flat.

However, shadows and effects should remain subtle.

8. Buttons

Buttons should clearly communicate their purpose.

Primary Button

Use the StudyFlow purple accent.

Example purposes:

Add Task
Save
Start Session
Create Note
Secondary Button

Use a darker surface with a subtle border.

Example purposes:

Cancel
View Details
Manage
Danger Button

Use the danger color only for destructive actions.

Example:

Delete Task
Delete Note

Buttons should have clear hover and active states.

9. Forms and Inputs

Inputs should be:

Dark
Clearly bordered
Easy to read
Comfortable to click
Consistent in height

Focused inputs should use the StudyFlow purple accent.

Forms should provide clear labels and useful validation feedback.

10. Status Indicators

Status information should be visually recognizable.

Examples:

Completed → Green
Due Today → Orange
High Priority → Red
Upcoming → Blue/Purple

Status colors should be used consistently across all pages.

11. Icons

Icons should be simple and consistent.

Icons should:

Support the meaning of the content
Not replace important text
Have consistent sizing
Use accent/status colors when appropriate

Avoid using too many different icon styles.

12. Dashboard Priority

The dashboard is the most important page.

It should prioritize:

Today's important tasks
Upcoming deadlines
Current progress
Upcoming exams
Study activity
Quick actions

The dashboard should answer:

"What should I focus on right now?"

as quickly as possible.

13. Responsive Design

StudyFlow must work properly on:

Desktop
Laptop
Tablet
Mobile

Desktop layouts may use multiple columns.

Mobile layouts should stack content vertically.

No important information should be hidden or become difficult to access on smaller screens.

14. Animation

Animations should be subtle and purposeful.

Use animation for:

Hover states
Button feedback
Card transitions
Progress indicators
Page transitions
Modal appearance

Avoid excessive animations that distract from studying.

15. Consistency Rules

All pages must follow the same design language.

The following should remain consistent:

Colors
Typography
Border radius
Buttons
Inputs
Cards
Spacing
Icons
Hover states
Responsive behavior

A new feature should extend the existing design system rather than introducing a completely different visual style.
16. Design Goal

The final version of StudyFlow should feel like a real student productivity product.

The interface should be:

Simple enough to use every day, but polished enough to feel like a professional application.

---

## 17. Standardized Product Terminology

To maintain conceptual clarity across pages and components, use these exact terms:

- **Subject**: An academic course or field of study (attributes: title, code, color, exam date).
- **Task**: An actionable academic deliverable (attributes: title, subject, category, priority, due date, estimated minutes, completion state).
- **Category**: A functional type of task (`Assignments`, `Reading`, `Revision`, `Practice`, `Project`, `Other`).
- **Priority**: Urgency/importance tier (`High`, `Medium`, `Low`).
- **Focus Session**: A timed study work block (`Focus`, `Short Break`, `Long Break`) linked to an optional subject.
- **Daily Focus Goal**: The student's target study duration per day (default 120 minutes), configurable in Settings.
- **Note**: A markdown-enabled study document with optional pinning and subject association.
- **Settings**: The application control center (App Preferences, Focus Goals, Diagnostics, Backup & Restore, About).

---

## 18. Accessibility & Motion Guidelines

- **Interactive Targets**: All interactive elements (buttons, links, form toggles) must meet or exceed 44×44px hit areas on touch devices.
- **Color Contrast**: Text must adhere to WCAG AA contrast standards against its respective background in both light and dark themes.
- **Reduced Motion**: All animations and transitions respect `prefers-reduced-motion: reduce` and the explicit user toggle in Settings (`data-reduced-motion="true"` on `<html>`).