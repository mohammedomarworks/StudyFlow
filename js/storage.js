/* ==========================================================================
   storage.js — Data layer
   --------------------------------------------------------------------------
   Two globals are defined here and shared by every page:

     • Dates — timezone-safe date helpers (parse/format/compare). All dates are
               stored as 'YYYY-MM-DD' strings and parsed at LOCAL midnight so a
               task never appears on the wrong calendar day.

     • Store — the only place that touches localStorage. Pages call semantic
               methods (getTasks, saveTask, toggleTask, getStats, getSessions…)
               and never read the raw keys directly, keeping data access
               consistent and backward-compatible.
   ========================================================================== */

/* ==========================================================================
   Dates — date utilities
   ========================================================================== */
const Dates = {
  /** Today as a 'YYYY-MM-DD' string in the user's local timezone. */
  todayISO() { return this.toISO(new Date()); },

  /** Convert a Date object to a local 'YYYY-MM-DD' string. */
  toISO(d) {
    if (!d || isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  /** Parse 'YYYY-MM-DD' into a Date at LOCAL midnight (avoids UTC shift). */
  parse(iso) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const parts = iso.split('-').map(Number);
    if (parts.some(Number.isNaN)) return null;
    const [y, m, d] = parts;
    const date = new Date(y, m - 1, d);
    // Date accepts overflow values such as 2026-02-30. Reject those rather
    // than silently moving tasks and exams into another month.
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
      ? date
      : null;
  },

  /** Whole days from today to the given date (negative = in the past). */
  daysFromToday(iso) {
    const target = this.parse(iso);
    if (!target) return null;
    const today = this.parse(this.todayISO());
    return Math.round((target - today) / 86400000);
  },

  /** Return a new ISO date offset from today by n days. */
  offsetISO(n) {
    const d = this.parse(this.todayISO());
    d.setDate(d.getDate() + n);
    return this.toISO(d);
  },

  /** 'Aug 16' */
  formatShort(iso) {
    const d = this.parse(iso);
    return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  },

  /** 'Aug 16, 2026' */
  formatFull(iso) {
    const d = this.parse(iso);
    return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  },

  /** 'Saturday, August 16, 2026' */
  formatLong(iso) {
    const d = this.parse(iso);
    return d ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';
  },

  /** Human relative label: Today / Tomorrow / in 3 days / 2 days ago. */
  relative(iso) {
    const diff = this.daysFromToday(iso);
    if (diff === null) return '';
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    if (diff < 0) return `${Math.abs(diff)} days ago`;
    return `in ${diff} days`;
  },

  /** Format minutes into clean human duration: '45m', '1h 30m', etc. */
  formatDuration(minutes) {
    const m = Number(minutes) || 0;
    if (m <= 0) return '0m';
    if (m < 60) return `${m}m`;
    const hours = Math.floor(m / 60);
    const rem = m % 60;
    return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
  },

  /** Human relative time from ISO datetime string (e.g. '2 hours ago') */
  timeAgo(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return this.formatShort(isoString.slice(0, 10));
  },

  /** Local calendar date for an ISO datetime (session timestamps are UTC). */
  localDateFromDateTime(isoString) {
    if (typeof isoString !== 'string') return '';
    const date = new Date(isoString);
    return isNaN(date.getTime()) ? '' : this.toISO(date);
  },

  /** 7 days of the local week (Monday through Sunday) containing baseDateISO */
  getWeekDates(baseDateISO = this.todayISO()) {
    const base = this.parse(baseDateISO) || this.parse(this.todayISO());
    const day = base.getDay(); // 0=Sun, 1=Mon...6=Sat
    const diffToMon = (day === 0 ? -6 : 1 - day);
    const monday = new Date(base);
    monday.setDate(base.getDate() + diffToMon);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      days.push(this.toISO(d));
    }
    return days;
  }
};

/* ==========================================================================
   Store — localStorage-backed data access
   ========================================================================== */
const Store = {
  KEYS: {
    subjects: 'sp_subjects',
    tasks:            'sp_tasks',
    habits:           'sp_habits',
    habitCompletions: 'sp_habit_completions',
    notes:            'sp_notes',
    sessions: 'sp_sessions',
    activity: 'sp_activity',
    settings: 'sp_settings',
    seeded:   'sp_seeded_v1'
  },

  TASK_CATEGORIES: [
    'Assignment',
    'Reading',
    'Revision',
    'Practice',
    'Project',
    'Exam Prep',
    'Other'
  ],

  /* ---- low-level read / write (with safe JSON parsing) ----------------- */
  _read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;   // corrupted value → fall back gracefully
    }
  },
  _write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error('StudyFlow Store write error:', e);
    }
  },

  /** Short unique id (timestamp + random) */
  uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  },

  /** Always return a plain array (guards against corrupt / non-array values). */
  _arr(key) {
    const v = this._read(key, []);
    return Array.isArray(v) ? v : [];
  },

  /** Validate a subject color; fall back to the brand purple when invalid.
      Colors are interpolated into inline `style` attributes, so this also
      prevents CSS/attribute injection from imported or malformed data. */
  _safeColor(color) {
    return (typeof color === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color.trim()))
      ? color.trim()
      : '#7c3aed';
  },

  /* ========================= ACTIVITY LOG ============================== */
  getActivity(limit = 20) {
    const list = this._arr(this.KEYS.activity);
    return list.slice(0, limit);
  },

  logActivity(type, title, meta = {}) {
    const list = this._arr(this.KEYS.activity);
    const entry = {
      id: this.uid(),
      type, // 'task_complete', 'task_create', 'session_finish', 'note_create', 'subject_create'
      title,
      timestamp: new Date().toISOString(),
      meta
    };
    list.unshift(entry);
    if (list.length > 50) list.length = 50; // keep recent 50
    this._write(this.KEYS.activity, list);
    return entry;
  },

  /* ========================= SUBJECTS =================================== */
  getSubjects() {
    // Normalize missing/invalid fields so a corrupt or imported record can
    // never crash a render (e.g. s.name.trim()) or inject a bad color.
    return this._arr(this.KEYS.subjects)
      .filter(s => s && typeof s === 'object')
      .map(s => ({
        ...s,
        id: s.id || this.uid(),
        name: (typeof s.name === 'string' && s.name.trim()) ? s.name : 'Untitled subject',
        color: this._safeColor(s.color),
        teacher: typeof s.teacher === 'string' ? s.teacher : '',
        examDate: Dates.parse(s.examDate) ? s.examDate : '',
        createdAt: typeof s.createdAt === 'string' ? s.createdAt : new Date().toISOString()
      }));
  },

  getSubject(id) {
    if (!id) return null;
    return this.getSubjects().find(s => s.id === id) || null;
  },

  saveSubject(data) {
    const subjects = this.getSubjects();
    if (data.id) {
      const i = subjects.findIndex(s => s.id === data.id);
      if (i > -1) {
        subjects[i] = { ...subjects[i], ...data };
      }
    } else {
      data.id = this.uid();
      data.createdAt = new Date().toISOString();
      subjects.push(data);
      this.logActivity('subject_create', `Created subject "${data.name}"`, { subjectId: data.id });
    }
    this._write(this.KEYS.subjects, subjects);
    return data;
  },

  /** Delete a subject and safely unlink it from any tasks, notes, sessions */
  deleteSubject(id) {
    const subj = this.getSubject(id);
    this._write(this.KEYS.subjects, this.getSubjects().filter(s => s.id !== id));

    // Unlink dependents rather than deleting user work
    const tasks = this.getTasks().map(t => t.subjectId === id ? { ...t, subjectId: '' } : t);
    this._write(this.KEYS.tasks, tasks);

    const habits = this.getHabits(true).map(h => h.subjectId === id ? { ...h, subjectId: '' } : h);
    this._write(this.KEYS.habits, habits);

    const notes = this.getNotes().map(n => n.subjectId === id ? { ...n, subjectId: '' } : n);
    this._write(this.KEYS.notes, notes);

    const sessions = this.getSessions().map(s => s.subjectId === id ? { ...s, subjectId: '' } : s);
    this._write(this.KEYS.sessions, sessions);

    if (subj) {
      this.logActivity('subject_delete', `Deleted subject "${subj.name}"`);
    }
  },

  /* =========================== TASKS ==================================== */
  getTasks() {
    const list = this._arr(this.KEYS.tasks).filter(t => t && typeof t === 'object');
    // Normalize missing fields for backward compatibility
    return list.map(t => ({
      id: t.id || this.uid(),
      title: (typeof t.title === 'string' && t.title.trim()) ? t.title : 'Untitled task',
      subjectId: typeof t.subjectId === 'string' ? t.subjectId : '',
      dueDate: Dates.parse(t.dueDate) ? t.dueDate : Dates.todayISO(),
      priority: ['high', 'medium', 'low'].includes(t.priority) ? t.priority : 'medium',
      estimate: Number(t.estimate) || 0,
      category: (typeof t.category === 'string' && t.category.trim()) ? t.category : 'General',
      notes: typeof t.notes === 'string' ? t.notes : '',
      completed: t.completed === true || t.completed === 'true',
      completedAt: t.completedAt || ((t.completed === true || t.completed === 'true') ? t.createdAt || new Date().toISOString() : null),
      createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString()
    }));
  },

  getTask(id) {
    if (!id) return null;
    return this.getTasks().find(t => t.id === id) || null;
  },

  saveTask(data) {
    const tasks = this.getTasks();
    if (data.id) {
      const i = tasks.findIndex(t => t.id === data.id);
      if (i > -1) {
        tasks[i] = { ...tasks[i], ...data };
      }
    } else {
      data.id = this.uid();
      data.completed = false;
      data.completedAt = null;
      data.createdAt = new Date().toISOString();
      tasks.push(data);
      this.logActivity('task_create', `Added task "${data.title}"`, { taskId: data.id, priority: data.priority });
    }
    this._write(this.KEYS.tasks, tasks);
    return data;
  },

  deleteTask(id) {
    const task = this.getTask(id);
    this._write(this.KEYS.tasks, this.getTasks().filter(t => t.id !== id));
    if (task) {
      this.logActivity('task_delete', `Deleted task "${task.title}"`);
    }
  },

  /** Flip a task's completed flag; returns the new state */
  toggleTask(id) {
    const tasks = this.getTasks();
    const t = tasks.find(x => x.id === id);
    if (!t) return null;

    t.completed = !t.completed;
    t.completedAt = t.completed ? new Date().toISOString() : null;
    this._write(this.KEYS.tasks, tasks);

    if (t.completed) {
      this.logActivity('task_complete', `Completed "${t.title}"`, { taskId: t.id });
    }
    return t.completed;
  },

  /* =========================== HABITS =================================== */
  getHabits(includeArchived = false) {
    const list = this._arr(this.KEYS.habits).filter(h => h && typeof h === 'object');
    const normalized = list.map(h => {
      const targetDays = Array.isArray(h.targetDays)
        ? h.targetDays.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
        : [0, 1, 2, 3, 4, 5, 6];
      return {
        id: h.id || this.uid(),
        name: (typeof h.name === 'string' && h.name.trim()) ? h.name.trim().slice(0, 60) : 'Untitled Habit',
        description: typeof h.description === 'string' ? h.description.trim().slice(0, 200) : '',
        icon: (typeof h.icon === 'string' && h.icon.trim()) ? h.icon.trim().slice(0, 8) : '⚡',
        color: this._safeColor(h.color),
        frequency: h.frequency === 'weekdays' ? 'weekdays' : 'daily',
        targetDays: h.frequency === 'weekdays' && targetDays.length > 0 ? targetDays : [0, 1, 2, 3, 4, 5, 6],
        subjectId: typeof h.subjectId === 'string' ? h.subjectId : '',
        createdAt: (typeof h.createdAt === 'string' && Dates.parse(h.createdAt.slice(0, 10))) ? h.createdAt : new Date().toISOString(),
        archived: Boolean(h.archived)
      };
    });
    return includeArchived ? normalized : normalized.filter(h => !h.archived);
  },

  getHabit(id) {
    if (!id) return null;
    return this.getHabits(true).find(h => h.id === id) || null;
  },

  saveHabit(data) {
    const habits = this.getHabits(true);
    const isNew = !data.id;
    let saved;

    const targetDays = Array.isArray(data.targetDays)
      ? data.targetDays.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
      : [0, 1, 2, 3, 4, 5, 6];

    const clean = {
      name: (typeof data.name === 'string' && data.name.trim()) ? data.name.trim().slice(0, 60) : 'Untitled Habit',
      description: typeof data.description === 'string' ? data.description.trim().slice(0, 200) : '',
      icon: (typeof data.icon === 'string' && data.icon.trim()) ? data.icon.trim().slice(0, 8) : '⚡',
      color: this._safeColor(data.color),
      frequency: data.frequency === 'weekdays' ? 'weekdays' : 'daily',
      targetDays: data.frequency === 'weekdays' && targetDays.length > 0 ? targetDays : [0, 1, 2, 3, 4, 5, 6],
      subjectId: typeof data.subjectId === 'string' ? data.subjectId : '',
      archived: Boolean(data.archived)
    };

    if (isNew) {
      saved = {
        ...clean,
        id: this.uid(),
        createdAt: data.createdAt || new Date().toISOString(),
        archived: false
      };
      habits.push(saved);
      this.logActivity('habit_create', `Created habit "${saved.name}"`, { habitId: saved.id });
    } else {
      const idx = habits.findIndex(h => h.id === data.id);
      if (idx > -1) {
        saved = { ...habits[idx], ...clean, id: data.id };
        habits[idx] = saved;
      } else {
        saved = { ...clean, id: data.id, createdAt: data.createdAt || new Date().toISOString() };
        habits.push(saved);
      }
    }
    this._write(this.KEYS.habits, habits);
    return saved;
  },

  archiveHabit(id) {
    const habits = this.getHabits(true);
    const h = habits.find(x => x.id === id);
    if (!h) return false;
    h.archived = true;
    this._write(this.KEYS.habits, habits);
    this.logActivity('habit_archive', `Archived habit "${h.name}"`, { habitId: h.id });
    return true;
  },

  restoreHabit(id) {
    const habits = this.getHabits(true);
    const h = habits.find(x => x.id === id);
    if (!h) return false;
    h.archived = false;
    this._write(this.KEYS.habits, habits);
    this.logActivity('habit_create', `Restored habit "${h.name}"`, { habitId: h.id });
    return true;
  },

  deleteHabit(id) {
    const habit = this.getHabit(id);
    const habits = this.getHabits(true).filter(h => h.id !== id);
    this._write(this.KEYS.habits, habits);

    const completions = this.getHabitCompletions().filter(c => c.habitId !== id);
    this._write(this.KEYS.habitCompletions, completions);

    if (habit) {
      this.logActivity('habit_archive', `Deleted habit "${habit.name}"`);
    }
    return true;
  },

  /* ===================== HABIT COMPLETIONS ============================== */
  getHabitCompletions(habitId = null) {
    const list = this._arr(this.KEYS.habitCompletions).filter(c => c && typeof c === 'object');
    const normalized = [];
    const seen = new Set();
    for (const c of list) {
      if (!c.habitId || !c.date) continue;
      if (!Dates.parse(c.date)) continue;
      const key = `${c.habitId}_${c.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push({
        id: c.id || this.uid(),
        habitId: String(c.habitId),
        date: String(c.date),
        completedAt: typeof c.completedAt === 'string' ? c.completedAt : new Date().toISOString()
      });
    }
    if (habitId) {
      return normalized.filter(c => c.habitId === habitId);
    }
    return normalized;
  },

  isHabitCompletedOnDate(habitId, dateISO) {
    if (!habitId || !dateISO) return false;
    return this.getHabitCompletions(habitId).some(c => c.date === dateISO);
  },

  toggleHabitCompletion(habitId, dateISO = Dates.todayISO()) {
    if (!habitId || !dateISO) return null;
    const today = Dates.todayISO();
    if (dateISO > today) return null; // Reject future dates

    const completions = this.getHabitCompletions();
    const existingIdx = completions.findIndex(c => c.habitId === habitId && c.date === dateISO);
    const habit = this.getHabit(habitId);

    if (existingIdx > -1) {
      completions.splice(existingIdx, 1);
      this._write(this.KEYS.habitCompletions, completions);
      return false;
    } else {
      const entry = {
        id: this.uid(),
        habitId,
        date: dateISO,
        completedAt: new Date().toISOString()
      };
      completions.push(entry);
      this._write(this.KEYS.habitCompletions, completions);

      if (habit) {
        this.logActivity('habit_complete', `Completed habit "${habit.name}"`, { habitId, date: dateISO });
      }
      return true;
    }
  },

  /** Explicitly set or clear completion for a habit on a date (idempotent) */
  setHabitCompletion(habitId, dateISO, completed = true) {
    if (!habitId || !dateISO) return false;
    const today = Dates.todayISO();
    if (dateISO > today) return false;
    const isDone = this.isHabitCompletedOnDate(habitId, dateISO);
    if (completed && !isDone) {
      return this.toggleHabitCompletion(habitId, dateISO) === true;
    } else if (!completed && isDone) {
      return this.toggleHabitCompletion(habitId, dateISO) === false;
    }
    return isDone;
  },

  /** Check if a habit is scheduled for a given Date or 'YYYY-MM-DD' */
  isHabitScheduledOn(habit, dateOrISO) {
    if (!habit) return false;
    const dateObj = typeof dateOrISO === 'string' ? Dates.parse(dateOrISO) : dateOrISO;
    if (!dateObj || isNaN(dateObj.getTime())) return false;
    if (habit.frequency === 'daily') return true;
    const day = dateObj.getDay();
    return Array.isArray(habit.targetDays) && habit.targetDays.includes(day);
  },

  /** Dynamically calculate current and best streaks for a habit */
  getHabitStreak(habitId) {
    const habit = this.getHabit(habitId);
    if (!habit) return { currentStreak: 0, bestStreak: 0 };

    const todayISO = Dates.todayISO();
    const today = Dates.parse(todayISO);
    const completions = this.getHabitCompletions(habitId);
    const completedSet = new Set(completions.map(c => c.date));

    const isSched = (d) => this.isHabitScheduledOn(habit, d);

    // 1. Current Streak calculation:
    let currentStreak = 0;
    const todaySched = isSched(today);
    const todayDone = completedSet.has(todayISO);

    if (todaySched && todayDone) {
      let count = 1;
      let offset = 1;
      while (offset < 1000) {
        const prev = new Date(today);
        prev.setDate(today.getDate() - offset);
        offset++;
        if (!isSched(prev)) continue;
        const prevISO = Dates.toISO(prev);
        if (completedSet.has(prevISO)) {
          count++;
        } else {
          break;
        }
      }
      currentStreak = count;
    } else {
      let lastSchedDate = null;
      let offset = 1;
      while (offset < 1000) {
        const prev = new Date(today);
        prev.setDate(today.getDate() - offset);
        offset++;
        if (isSched(prev)) {
          lastSchedDate = prev;
          break;
        }
      }

      if (lastSchedDate && completedSet.has(Dates.toISO(lastSchedDate))) {
        let count = 1;
        while (offset < 1000) {
          const prev = new Date(today);
          prev.setDate(today.getDate() - offset);
          offset++;
          if (!isSched(prev)) continue;
          const prevISO = Dates.toISO(prev);
          if (completedSet.has(prevISO)) {
            count++;
          } else {
            break;
          }
        }
        currentStreak = count;
      } else {
        currentStreak = 0;
      }
    }

    // 2. Best Streak calculation:
    let earliestISO = Dates.localDateFromDateTime(habit.createdAt) || todayISO;
    for (const c of completions) {
      if (c.date < earliestISO) earliestISO = c.date;
    }
    const startDate = Dates.parse(earliestISO) || today;

    let bestStreak = 0;
    let runningStreak = 0;
    const cur = new Date(startDate);

    while (cur <= today) {
      if (isSched(cur)) {
        const iso = Dates.toISO(cur);
        if (completedSet.has(iso)) {
          runningStreak++;
          if (runningStreak > bestStreak) bestStreak = runningStreak;
        } else {
          runningStreak = 0;
        }
      }
      cur.setDate(cur.getDate() + 1);
    }

    if (currentStreak > bestStreak) bestStreak = currentStreak;

    return { currentStreak, bestStreak };
  },

  /** Weekly status for a habit across the 7 days of the local week */
  getHabitWeeklyStatus(habitId, weekDays = null) {
    const habit = this.getHabit(habitId);
    if (!habit) return [];
    const days = weekDays || Dates.getWeekDates();
    const today = Dates.todayISO();

    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    return days.map((dateISO, idx) => {
      const d = Dates.parse(dateISO);
      const isSched = this.isHabitScheduledOn(habit, d);
      const isCompleted = this.isHabitCompletedOnDate(habitId, dateISO);

      let status = 'unscheduled';
      if (isSched) {
        if (isCompleted) {
          status = 'completed';
        } else if (dateISO < today) {
          status = 'missed';
        } else if (dateISO === today) {
          status = 'pending';
        } else {
          status = 'future';
        }
      }

      return {
        date: dateISO,
        dayName: dayLabels[idx],
        isScheduled: isSched,
        isCompleted,
        status
      };
    });
  },

  /** Aggregate habit metrics used across Habits page, Dashboard, Progress & Settings */
  getHabitStats() {
    const activeHabits = this.getHabits(false);
    const today = Dates.todayISO();
    const todayDate = Dates.parse(today);

    // Habits scheduled for today
    const scheduledToday = activeHabits.filter(h => this.isHabitScheduledOn(h, todayDate));
    const completedToday = scheduledToday.filter(h => this.isHabitCompletedOnDate(h.id, today)).length;
    const totalToday = scheduledToday.length;
    const rateToday = totalToday > 0 ? Math.round((completedToday / totalToday) * 100) : 0;

    // Habits scheduled this week (Mon-Sun)
    const weekDays = Dates.getWeekDates(today);
    let totalWeekScheduled = 0;
    let totalWeekCompleted = 0;

    for (const h of activeHabits) {
      for (const dStr of weekDays) {
        const d = Dates.parse(dStr);
        if (this.isHabitScheduledOn(h, d)) {
          totalWeekScheduled++;
          if (this.isHabitCompletedOnDate(h.id, dStr)) {
            totalWeekCompleted++;
          }
        }
      }
    }

    const rateWeek = totalWeekScheduled > 0 ? Math.round((totalWeekCompleted / totalWeekScheduled) * 100) : 0;

    // Best active streak
    let bestCurrentStreak = 0;
    for (const h of activeHabits) {
      const { currentStreak } = this.getHabitStreak(h.id);
      if (currentStreak > bestCurrentStreak) bestCurrentStreak = currentStreak;
    }

    return {
      activeCount: activeHabits.length,
      totalToday,
      completedToday,
      rateToday,
      totalWeekScheduled,
      totalWeekCompleted,
      rateWeek,
      bestCurrentStreak
    };
  },

  /* =========================== NOTES ==================================== */
  getNotes() {
    const list = this._arr(this.KEYS.notes).filter(n => n && typeof n === 'object');
    return list.map(n => ({
      id: n.id || this.uid(),
      title: (typeof n.title === 'string' && n.title.trim()) ? n.title : 'Untitled Note',
      subjectId: typeof n.subjectId === 'string' ? n.subjectId : '',
      content: typeof n.content === 'string' ? n.content : '',
      tags: Array.isArray(n.tags) ? n.tags.filter(tag => typeof tag === 'string') : [],
      pinned: Boolean(n.pinned),
      createdAt: typeof n.createdAt === 'string' ? n.createdAt : new Date().toISOString(),
      updatedAt: typeof n.updatedAt === 'string' ? n.updatedAt : (typeof n.createdAt === 'string' ? n.createdAt : new Date().toISOString())
    }));
  },

  getNote(id) {
    if (!id) return null;
    return this.getNotes().find(n => n.id === id) || null;
  },

  saveNote(data) {
    const notes = this.getNotes();
    const now = new Date().toISOString();
    const i = data.id ? notes.findIndex(n => n.id === data.id) : -1;
    if (i > -1) {
      notes[i] = {
        ...notes[i],
        ...data,
        pinned: typeof data.pinned === 'boolean' ? data.pinned : notes[i].pinned,
        updatedAt: data.updatedAt || now
      };
    } else {
      data.id = data.id || this.uid();
      data.pinned = Boolean(data.pinned);
      data.createdAt = data.createdAt || now;
      data.updatedAt = data.updatedAt || now;
      notes.push(data);
      this.logActivity('note_create', `Created note "${data.title}"`, { noteId: data.id });
    }
    this._write(this.KEYS.notes, notes);
    return data;
  },

  togglePinNote(id) {
    const notes = this.getNotes();
    const note = notes.find(n => n.id === id);
    if (!note) return false;
    note.pinned = !note.pinned;
    this._write(this.KEYS.notes, notes);
    return note.pinned;
  },

  deleteNote(id) {
    const note = this.getNote(id);
    this._write(this.KEYS.notes, this.getNotes().filter(n => n.id !== id));
    if (note) {
      this.logActivity('note_delete', `Deleted note "${note.title}"`);
    }
  },

  /* ======================= STUDY SESSIONS =============================== */
  getSessions() {
    const list = this._arr(this.KEYS.sessions).filter(s => s && typeof s === 'object');
    return list.map(s => ({
      id: s.id || this.uid(),
      subjectId: s.subjectId || '',
      taskId: s.taskId || '',
      durationMinutes: Number(s.durationMinutes) || 25,
      type: s.type || 'focus', // 'focus' | 'break'
      completedAt: s.completedAt || new Date().toISOString(),
      notes: s.notes || ''
    }));
  },

  saveSession(data) {
    const sessions = this.getSessions();
    if (!data.id) {
      data.id = this.uid();
      // A session logged from the timer is a focus session unless explicitly
      // marked as a break. Normalizing here means the activity feed and stats
      // stay correct even if a caller omits `type`.
      data.type = data.type === 'break' ? 'break' : 'focus';
      data.durationMinutes = Number(data.durationMinutes) || 0;
      data.completedAt = data.completedAt || new Date().toISOString();
      sessions.unshift(data);
    } else {
      const i = sessions.findIndex(s => s.id === data.id);
      if (i > -1) sessions[i] = { ...sessions[i], ...data };
    }
    this._write(this.KEYS.sessions, sessions);

    if (data.type === 'focus') {
      const subj = this.getSubject(data.subjectId);
      const task = this.getTask(data.taskId);
      let label = 'Focus study session';
      if (task) label = `Focus session on "${task.title}"`;
      else if (subj) label = `Focus session on ${subj.name}`;
      this.logActivity('session_finish', `Completed ${data.durationMinutes}m ${label}`, {
        duration: data.durationMinutes,
        subjectId: data.subjectId,
        taskId: data.taskId || ''
      });
    }
    return data;
  },

  deleteSession(id) {
    this._write(this.KEYS.sessions, this.getSessions().filter(s => s.id !== id));
  },

  getStudyStats() {
    const sessions = this.getSessions().filter(s => s.type === 'focus');
    const today = Dates.todayISO();

    const totalMinutes = sessions.reduce((acc, s) => acc + (s.durationMinutes || 0), 0);
    const todaySessions = sessions.filter(s => Dates.localDateFromDateTime(s.completedAt) === today);
    const todayMinutes = todaySessions.reduce((acc, s) => acc + (s.durationMinutes || 0), 0);

    // Calculate active streak days
    const uniqueDays = new Set(sessions.map(s => Dates.localDateFromDateTime(s.completedAt)).filter(Boolean));
    let streak = 0;
    let checkDate = new Date();
    // Check if today has a session, or if yesterday was the last
    const todayStr = Dates.toISO(checkDate);
    if (!uniqueDays.has(todayStr)) {
      // Check yesterday
      checkDate.setDate(checkDate.getDate() - 1);
    }
    while (uniqueDays.has(Dates.toISO(checkDate))) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    }

    // Calculate longest streak
    const sortedDays = Array.from(uniqueDays).sort();
    let longestStreak = 0;
    let currentRun = 0;
    let prevDate = null;
    for (const dStr of sortedDays) {
      const d = Dates.parse(dStr);
      if (!d) continue;
      if (!prevDate) {
        currentRun = 1;
      } else {
        const diffDays = Math.round((d - prevDate) / 86400000);
        if (diffDays === 1) {
          currentRun++;
        } else if (diffDays > 1) {
          currentRun = 1;
        }
      }
      if (currentRun > longestStreak) longestStreak = currentRun;
      prevDate = d;
    }

    return {
      totalMinutes,
      totalHours: Number((totalMinutes / 60).toFixed(1)),
      todayMinutes,
      totalSessions: sessions.length,
      todaySessionsCount: todaySessions.length,
      streakDays: streak,
      longestStreak
    };
  },

  /** Get all-time longest continuous study streak in days */
  getLongestStreak() {
    return this.getStudyStats().longestStreak;
  },

  /** Aggregate focus metrics for the current week (Sun–Sat) */
  getWeeklyStudyStats() {
    const sessions = this.getSessions().filter(s => s.type === 'focus');
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - dayOfWeek);
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);

    const weekSessions = sessions.filter(s => {
      const d = new Date(s.completedAt);
      return d >= startOfWeek && d < endOfWeek;
    });

    const totalMinutes = weekSessions.reduce((acc, s) => acc + (s.durationMinutes || 0), 0);
    const sessionCount = weekSessions.length;
    const avgMinutes = sessionCount ? Math.round(totalMinutes / sessionCount) : 0;

    // Most studied subject this week
    const subjectMinutes = {};
    weekSessions.forEach(s => {
      if (s.subjectId) {
        subjectMinutes[s.subjectId] = (subjectMinutes[s.subjectId] || 0) + (s.durationMinutes || 0);
      }
    });

    let mostStudiedSubjectId = null;
    let maxSubjMin = 0;
    for (const [sId, mins] of Object.entries(subjectMinutes)) {
      if (mins > maxSubjMin) {
        maxSubjMin = mins;
        mostStudiedSubjectId = sId;
      }
    }

    const mostStudiedSubject = mostStudiedSubjectId ? this.getSubject(mostStudiedSubjectId) : null;

    return {
      totalMinutes,
      sessionCount,
      avgMinutes,
      mostStudiedSubject,
      mostStudiedMinutes: maxSubjMin
    };
  },

  /** Get total invested focus minutes for a specific task */
  getTaskStudyMinutes(taskId) {
    if (!taskId) return 0;
    return this.getSessions()
      .filter(s => s.taskId === taskId && s.type === 'focus')
      .reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
  },

  /** Get total focus minutes for a specific subject this week */
  getSubjectWeeklyMinutes(subjectId) {
    if (!subjectId) return 0;
    const now = new Date();
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - dayOfWeek);
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);

    return this.getSessions()
      .filter(s => s.subjectId === subjectId && s.type === 'focus' && new Date(s.completedAt) >= startOfWeek && new Date(s.completedAt) < endOfWeek)
      .reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
  },

  /* ========================= SETTINGS =================================== */
  getSettings() {
    const defaults = {
      theme: 'system', // 'light' | 'dark' | 'system'
      pomodoro: {
        focus: 25,       // minutes — key matches timer.js & settings.js
        shortBreak: 5,
        longBreak: 15,
        sound: true,
        autoBreak: false,
        dailyGoal: 120   // daily focus goal in minutes (default 2h, 0 = disabled)
      },
      preferences: {
        confirmDelete: true,           // show confirm modal before deleting tasks/notes
        defaultTaskSort: 'due-asc',    // default sort on Tasks page
        motion: 'system'               // 'system' | 'reduce' | 'full'
      },
      lastExportAt: null               // ISO timestamp of last backup export
    };
    const s = this._read(this.KEYS.settings, {});
    const raw = (s && typeof s === 'object') ? s : {};
    const pomo = (raw.pomodoro && typeof raw.pomodoro === 'object') ? raw.pomodoro : {};
    const prefs = (raw.preferences && typeof raw.preferences === 'object') ? raw.preferences : {};

    // Migrate the legacy `focusTime` key to `focus` if an old backup is loaded.
    if (pomo.focus == null && pomo.focusTime != null) pomo.focus = pomo.focusTime;
    const normalizeDuration = (value, fallback, min, max) => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
    };

    const validSorts = ['due-asc', 'due-desc', 'priority-desc', 'title-asc', 'duration-desc'];
    const validMotions = ['system', 'reduce', 'full'];

    return {
      ...defaults,
      ...raw,
      theme: ['light', 'dark', 'system'].includes(raw.theme) ? raw.theme : defaults.theme,
      pomodoro: {
        ...defaults.pomodoro,
        ...pomo,
        focus: normalizeDuration(pomo.focus, defaults.pomodoro.focus, 1, 120),
        shortBreak: normalizeDuration(pomo.shortBreak, defaults.pomodoro.shortBreak, 1, 30),
        longBreak: normalizeDuration(pomo.longBreak, defaults.pomodoro.longBreak, 1, 60),
        sound: typeof pomo.sound === 'boolean' ? pomo.sound : defaults.pomodoro.sound,
        autoBreak: typeof pomo.autoBreak === 'boolean' ? pomo.autoBreak : defaults.pomodoro.autoBreak,
        dailyGoal: normalizeDuration(pomo.dailyGoal != null ? pomo.dailyGoal : defaults.pomodoro.dailyGoal, defaults.pomodoro.dailyGoal, 0, 720)
      },
      preferences: {
        ...defaults.preferences,
        ...prefs,
        confirmDelete: typeof prefs.confirmDelete === 'boolean' ? prefs.confirmDelete : defaults.preferences.confirmDelete,
        defaultTaskSort: validSorts.includes(prefs.defaultTaskSort) ? prefs.defaultTaskSort : defaults.preferences.defaultTaskSort,
        motion: validMotions.includes(prefs.motion) ? prefs.motion : defaults.preferences.motion
      },
      lastExportAt: (typeof raw.lastExportAt === 'string' && raw.lastExportAt) ? raw.lastExportAt : null
    };
  },

  setSetting(key, value) {
    const s = this.getSettings();
    s[key] = value;
    this._write(this.KEYS.settings, s);
  },

  /** Merge-save settings. Nested `pomodoro` and `preferences` are merged (not replaced)
      so saving only a subset never drops peer preferences. */
  saveSettings(newSettings = {}) {
    const current = this.getSettings();
    const merged = { ...current, ...newSettings };
    if (newSettings.pomodoro) {
      merged.pomodoro = { ...current.pomodoro, ...newSettings.pomodoro };
    }
    if (newSettings.preferences) {
      merged.preferences = { ...current.preferences, ...newSettings.preferences };
    }
    this._write(this.KEYS.settings, merged);
    return merged;
  },

  /* ===================== DERIVED STATISTICS ============================= */
  /** Aggregate counts used across Dashboard, Progress, and About pages */
  getStats() {
    const tasks = this.getTasks();
    const subjects = this.getSubjects();
    const notes = this.getNotes();
    const today = Dates.todayISO();
    const study = this.getStudyStats();

    const completed = tasks.filter(t => t.completed).length;
    const total = tasks.length;
    const pending = total - completed;
    const overdue = tasks.filter(t => !t.completed && t.dueDate && t.dueDate < today).length;
    const dueToday = tasks.filter(t => !t.completed && t.dueDate === today).length;

    // Upcoming in next 7 days (exclusive of today)
    const next7Days = Dates.offsetISO(7);
    const upcomingTasks = tasks.filter(t => !t.completed && t.dueDate && t.dueDate > today && t.dueDate <= next7Days).length;

    const upcomingExams = subjects.filter(s => s.examDate && s.examDate >= today).length;

    return {
      total,
      completed,
      pending,
      overdue,
      dueToday,
      upcomingTasks,
      upcomingExams,
      subjects: subjects.length,
      notes: notes.length,
      completionRate: total ? Math.round((completed / total) * 100) : 0,
      totalFocusMinutes: study.totalMinutes,
      todayFocusMinutes: study.todayMinutes,
      totalSessions: study.totalSessions,
      streakDays: study.streakDays
    };
  },

  /** Per-subject completion and workload figures */
  getSubjectProgress() {
    const tasks = this.getTasks();
    const notes = this.getNotes();
    const sessions = this.getSessions().filter(s => s.type === 'focus');
    const today = Dates.todayISO();

    return this.getSubjects().map(s => {
      const subTasks = tasks.filter(t => t.subjectId === s.id);
      const done = subTasks.filter(t => t.completed).length;
      const active = subTasks.length - done;
      const overdue = subTasks.filter(t => !t.completed && t.dueDate && t.dueDate < today).length;
      const subNotes = notes.filter(n => n.subjectId === s.id).length;
      const subMinutes = sessions.filter(x => x.subjectId === s.id).reduce((acc, x) => acc + (x.durationMinutes || 0), 0);

      return {
        ...s,
        totalTasks: subTasks.length,
        doneTasks: done,
        activeTasks: active,
        overdueTasks: overdue,
        notesCount: subNotes,
        focusMinutes: subMinutes,
        percent: subTasks.length ? Math.round((done / subTasks.length) * 100) : 0
      };
    });
  },

  /* ===================== STORAGE DIAGNOSTICS =========================== */
  /** In-memory storage overview and entity diagnostics */
  getDiagnostics() {
    const tasks = this.getTasks();
    const subjects = this.getSubjects();
    const notes = this.getNotes();
    const sessions = this.getSessions();
    const activity = this.getActivity(100);
    const settings = this.getSettings();
    const studyStats = this.getStudyStats();

    const activeTasks = tasks.filter(t => !t.completed).length;
    const completedTasks = tasks.filter(t => t.completed).length;
    const pinnedNotes = notes.filter(n => n.pinned).length;

    const habits = this.getHabits(true);
    const activeHabits = habits.filter(h => !h.archived);
    const habitStats = this.getHabitStats();

    return {
      subjectsCount: subjects.length,
      tasksTotal: tasks.length,
      tasksActive: activeTasks,
      tasksCompleted: completedTasks,
      notesTotal: notes.length,
      notesPinned: pinnedNotes,
      sessionsCount: sessions.length,
      focusMinutes: studyStats.totalMinutes,
      focusHours: studyStats.totalHours,
      activityCount: activity.length,
      habitsTotal: habits.length,
      habitsActive: activeHabits.length,
      habitsCompletedToday: habitStats.completedToday,
      lastExportAt: settings.lastExportAt
    };
  },

  /* ===================== BACKUP & RESTORE =============================== */
  exportJSON() {
    const nowISO = new Date().toISOString();
    // Record export timestamp in settings
    this.saveSettings({ lastExportAt: nowISO });

    const data = {
      version: '2.0.0',
      exportedAt: nowISO,
      subjects: this.getSubjects(),
      tasks: this.getTasks(),
      habits: this.getHabits(true),
      habitCompletions: this.getHabitCompletions(),
      notes: this.getNotes(),
      sessions: this.getSessions(),
      activity: this.getActivity(50),
      settings: this.getSettings()
    };
    return JSON.stringify(data, null, 2);
  },

  /** Validate a backup file string or parsed object non-destructively.
      Returns { valid: true, version, exportedAt, counts, currentCounts, normalizedData }
      or { valid: false, error }. */
  validateBackup(input) {
    let data = input;
    if (typeof input === 'string') {
      try {
        data = JSON.parse(input);
      } catch (e) {
        return { valid: false, error: 'Could not read the file — it is not valid JSON.' };
      }
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { valid: false, error: 'Invalid backup file format: root must be a JSON object.' };
    }

    const knownKeys = ['subjects', 'tasks', 'habits', 'habitCompletions', 'notes', 'sessions', 'activity', 'settings'];
    const hasKnown = knownKeys.some(k => k in data);
    if (!hasKnown) {
      return { valid: false, error: 'This file does not contain recognized StudyFlow data.' };
    }

    // Safely sanitize and normalize data entities
    let normalizedSubjects = null;
    if ('subjects' in data) {
      if (!Array.isArray(data.subjects)) {
        return { valid: false, error: 'Malformed backup: "subjects" must be a list.' };
      }
      normalizedSubjects = data.subjects
        .filter(s => s && typeof s === 'object')
        .map(s => ({
          id: s.id || this.uid(),
          name: (typeof s.name === 'string' && s.name.trim()) ? s.name.trim() : 'Untitled subject',
          color: this._safeColor(s.color),
          teacher: typeof s.teacher === 'string' ? s.teacher : '',
          examDate: Dates.parse(s.examDate) ? s.examDate : '',
          createdAt: typeof s.createdAt === 'string' ? s.createdAt : new Date().toISOString()
        }));
    }

    let normalizedTasks = null;
    if ('tasks' in data) {
      if (!Array.isArray(data.tasks)) {
        return { valid: false, error: 'Malformed backup: "tasks" must be a list.' };
      }
      normalizedTasks = data.tasks
        .filter(t => t && typeof t === 'object')
        .map(t => ({
          id: t.id || this.uid(),
          title: (typeof t.title === 'string' && t.title.trim()) ? t.title.trim() : 'Untitled task',
          subjectId: typeof t.subjectId === 'string' ? t.subjectId : '',
          dueDate: Dates.parse(t.dueDate) ? t.dueDate : Dates.todayISO(),
          priority: ['high', 'medium', 'low'].includes(t.priority) ? t.priority : 'medium',
          estimate: Math.max(0, Math.min(720, Number(t.estimate) || 0)),
          category: (typeof t.category === 'string' && t.category.trim()) ? t.category.trim() : 'General',
          notes: typeof t.notes === 'string' ? t.notes : '',
          completed: t.completed === true || t.completed === 'true',
          completedAt: t.completedAt || ((t.completed === true || t.completed === 'true') ? t.createdAt || new Date().toISOString() : null),
          createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString()
        }));
    }

    let normalizedHabits = null;
    if ('habits' in data) {
      if (!Array.isArray(data.habits)) {
        return { valid: false, error: 'Malformed backup: "habits" must be a list.' };
      }
      normalizedHabits = data.habits
        .filter(h => h && typeof h === 'object')
        .map(h => {
          const targetDays = Array.isArray(h.targetDays)
            ? h.targetDays.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
            : [0, 1, 2, 3, 4, 5, 6];
          return {
            id: h.id || this.uid(),
            name: (typeof h.name === 'string' && h.name.trim()) ? h.name.trim().slice(0, 60) : 'Untitled Habit',
            description: typeof h.description === 'string' ? h.description.trim().slice(0, 200) : '',
            icon: (typeof h.icon === 'string' && h.icon.trim()) ? h.icon.trim().slice(0, 8) : '⚡',
            color: this._safeColor(h.color),
            frequency: h.frequency === 'weekdays' ? 'weekdays' : 'daily',
            targetDays: h.frequency === 'weekdays' && targetDays.length > 0 ? targetDays : [0, 1, 2, 3, 4, 5, 6],
            subjectId: typeof h.subjectId === 'string' ? h.subjectId : '',
            createdAt: (typeof h.createdAt === 'string' && Dates.parse(h.createdAt.slice(0, 10))) ? h.createdAt : new Date().toISOString(),
            archived: Boolean(h.archived)
          };
        });
    }

    let normalizedHabitCompletions = null;
    if ('habitCompletions' in data) {
      if (!Array.isArray(data.habitCompletions)) {
        return { valid: false, error: 'Malformed backup: "habitCompletions" must be a list.' };
      }
      const seen = new Set();
      normalizedHabitCompletions = [];
      for (const c of data.habitCompletions) {
        if (!c || typeof c !== 'object' || !c.habitId || !c.date) continue;
        if (!Dates.parse(c.date)) continue;
        const key = `${c.habitId}_${c.date}`;
        if (seen.has(key)) continue;
        seen.add(key);
        normalizedHabitCompletions.push({
          id: c.id || this.uid(),
          habitId: String(c.habitId),
          date: String(c.date),
          completedAt: typeof c.completedAt === 'string' ? c.completedAt : new Date().toISOString()
        });
      }
    }

    let normalizedNotes = null;
    if ('notes' in data) {
      if (!Array.isArray(data.notes)) {
        return { valid: false, error: 'Malformed backup: "notes" must be a list.' };
      }
      normalizedNotes = data.notes
        .filter(n => n && typeof n === 'object')
        .map(n => ({
          id: n.id || this.uid(),
          title: (typeof n.title === 'string' && n.title.trim()) ? n.title.trim() : 'Untitled Note',
          subjectId: typeof n.subjectId === 'string' ? n.subjectId : '',
          content: typeof n.content === 'string' ? n.content : '',
          tags: Array.isArray(n.tags) ? n.tags.filter(tag => typeof tag === 'string') : [],
          pinned: Boolean(n.pinned),
          createdAt: typeof n.createdAt === 'string' ? n.createdAt : new Date().toISOString(),
          updatedAt: typeof n.updatedAt === 'string' ? n.updatedAt : (typeof n.createdAt === 'string' ? n.createdAt : new Date().toISOString())
        }));
    }

    let normalizedSessions = null;
    if ('sessions' in data) {
      if (!Array.isArray(data.sessions)) {
        return { valid: false, error: 'Malformed backup: "sessions" must be a list.' };
      }
      normalizedSessions = data.sessions
        .filter(s => s && typeof s === 'object')
        .map(s => ({
          id: s.id || this.uid(),
          subjectId: s.subjectId || '',
          taskId: s.taskId || '',
          durationMinutes: Math.max(1, Math.min(720, Number(s.durationMinutes) || 25)),
          type: s.type === 'break' ? 'break' : 'focus',
          completedAt: s.completedAt || new Date().toISOString(),
          notes: s.notes || ''
        }));
    }

    let normalizedActivity = null;
    if ('activity' in data) {
      if (!Array.isArray(data.activity)) {
        return { valid: false, error: 'Malformed backup: "activity" must be a list.' };
      }
      normalizedActivity = data.activity
        .filter(a => a && typeof a === 'object')
        .slice(0, 50)
        .map(a => ({
          id: a.id || this.uid(),
          type: a.type || 'activity',
          title: (typeof a.title === 'string' && a.title) ? a.title : 'Activity event',
          timestamp: typeof a.timestamp === 'string' ? a.timestamp : new Date().toISOString(),
          meta: (a.meta && typeof a.meta === 'object') ? a.meta : {}
        }));
    }

    let normalizedSettings = null;
    if ('settings' in data && data.settings && typeof data.settings === 'object') {
      const s = data.settings;
      const pomo = (s.pomodoro && typeof s.pomodoro === 'object') ? s.pomodoro : {};
      const prefs = (s.preferences && typeof s.preferences === 'object') ? s.preferences : {};
      const validSorts = ['due-asc', 'due-desc', 'priority-desc', 'title-asc', 'duration-desc'];
      const validMotions = ['system', 'reduce', 'full'];

      normalizedSettings = {
        theme: ['light', 'dark', 'system'].includes(s.theme) ? s.theme : 'system',
        pomodoro: {
          focus: Math.max(1, Math.min(120, Number(pomo.focus || pomo.focusTime) || 25)),
          shortBreak: Math.max(1, Math.min(30, Number(pomo.shortBreak) || 5)),
          longBreak: Math.max(1, Math.min(60, Number(pomo.longBreak) || 15)),
          sound: typeof pomo.sound === 'boolean' ? pomo.sound : true,
          autoBreak: typeof pomo.autoBreak === 'boolean' ? pomo.autoBreak : false,
          dailyGoal: Math.max(0, Math.min(720, Number(pomo.dailyGoal != null ? pomo.dailyGoal : 120)))
        },
        preferences: {
          confirmDelete: typeof prefs.confirmDelete === 'boolean' ? prefs.confirmDelete : true,
          defaultTaskSort: validSorts.includes(prefs.defaultTaskSort) ? prefs.defaultTaskSort : 'due-asc',
          motion: validMotions.includes(prefs.motion) ? prefs.motion : 'system'
        },
        lastExportAt: (typeof s.lastExportAt === 'string' && s.lastExportAt) ? s.lastExportAt : null
      };
    }

    const currentDiag = this.getDiagnostics();

    return {
      valid: true,
      version: data.version || '1.0.0',
      exportedAt: data.exportedAt || null,
      counts: {
        subjects: normalizedSubjects ? normalizedSubjects.length : 0,
        tasks: normalizedTasks ? normalizedTasks.length : 0,
        habits: normalizedHabits ? normalizedHabits.length : 0,
        habitCompletions: normalizedHabitCompletions ? normalizedHabitCompletions.length : 0,
        notes: normalizedNotes ? normalizedNotes.length : 0,
        sessions: normalizedSessions ? normalizedSessions.length : 0,
        activity: normalizedActivity ? normalizedActivity.length : 0,
        hasSettings: Boolean(normalizedSettings)
      },
      currentCounts: {
        subjects: currentDiag.subjectsCount,
        tasks: currentDiag.tasksTotal,
        habits: currentDiag.habitsTotal,
        notes: currentDiag.notesTotal,
        sessions: currentDiag.sessionsCount,
        activity: currentDiag.activityCount
      },
      normalizedData: {
        version: data.version || '2.0.0',
        subjects: normalizedSubjects,
        tasks: normalizedTasks,
        habits: normalizedHabits,
        habitCompletions: normalizedHabitCompletions,
        notes: normalizedNotes,
        sessions: normalizedSessions,
        activity: normalizedActivity,
        settings: normalizedSettings
      }
    };
  },

  /** Apply an already-validated backup to storage atomically. */
  applyBackup(normalizedData) {
    if (!normalizedData || typeof normalizedData !== 'object') {
      return { success: false, error: 'Invalid backup payload.' };
    }

    try {
      if (Array.isArray(normalizedData.subjects)) {
        this._write(this.KEYS.subjects, normalizedData.subjects);
      }
      if (Array.isArray(normalizedData.tasks)) {
        this._write(this.KEYS.tasks, normalizedData.tasks);
      }
      if (Array.isArray(normalizedData.habits)) {
        this._write(this.KEYS.habits, normalizedData.habits);
      }
      if (Array.isArray(normalizedData.habitCompletions)) {
        this._write(this.KEYS.habitCompletions, normalizedData.habitCompletions);
      }
      if (Array.isArray(normalizedData.notes)) {
        this._write(this.KEYS.notes, normalizedData.notes);
      }
      if (Array.isArray(normalizedData.sessions)) {
        this._write(this.KEYS.sessions, normalizedData.sessions);
      }
      if (Array.isArray(normalizedData.activity)) {
        this._write(this.KEYS.activity, normalizedData.activity);
      }
      if (normalizedData.settings) {
        this._write(this.KEYS.settings, normalizedData.settings);
      }

      // Mark seeded so starter seed never fires on refresh
      localStorage.setItem(this.KEYS.seeded, '1');

      // Log activity
      const counts = {
        subjects: (normalizedData.subjects || []).length,
        tasks: (normalizedData.tasks || []).length,
        habits: (normalizedData.habits || []).length,
        notes: (normalizedData.notes || []).length,
        sessions: (normalizedData.sessions || []).length
      };
      this.logActivity('backup_import', `Restored backup (${counts.tasks} tasks, ${counts.habits} habits, ${counts.subjects} subjects, ${counts.notes} notes)`);

      return { success: true, counts };
    } catch (e) {
      return { success: false, error: 'Failed to restore backup: ' + e.message };
    }
  },

  importJSON(jsonString) {
    const validation = this.validateBackup(jsonString);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    const res = this.applyBackup(validation.normalizedData);
    return res;
  },

  /* ======================= SEED (first run) ============================= */
  /** Populate friendly example data the first time the app is opened */
  seedIfEmpty() {
    if (localStorage.getItem(this.KEYS.seeded)) return;

    // Do not infer "new user" only from the seed marker: older releases and
    // hand-restored data may have valid sp_* records without it. Seeding in
    // that state would replace a user's existing planner.
    const dataKeys = [this.KEYS.subjects, this.KEYS.tasks, this.KEYS.habits, this.KEYS.habitCompletions, this.KEYS.notes, this.KEYS.sessions, this.KEYS.activity, this.KEYS.settings];
    if (dataKeys.some(key => localStorage.getItem(key) !== null)) {
      localStorage.setItem(this.KEYS.seeded, '1');
      return;
    }

    const subjects = [
      { id: 's1', name: 'Mathematics',        color: '#7c3aed', teacher: 'Dr. Alan Reed',   examDate: Dates.offsetISO(9),  createdAt: new Date().toISOString() },
      { id: 's2', name: 'Computer Science',    color: '#2563eb', teacher: 'Prof. Kim Ito',   examDate: Dates.offsetISO(16), createdAt: new Date().toISOString() },
      { id: 's3', name: 'Physics',             color: '#0d9488', teacher: 'Dr. Sara Osei',   examDate: Dates.offsetISO(4),  createdAt: new Date().toISOString() },
      { id: 's4', name: 'English Literature',  color: '#db2777', teacher: 'Ms. Lena Park',   examDate: '',                  createdAt: new Date().toISOString() }
    ];

    const tasks = [
      { id: 't1', title: 'Complete calculus problem set 5', subjectId: 's1', dueDate: Dates.todayISO(),   priority: 'high',   category: 'Assignment', estimate: 60, notes: 'Chapters 4–5, focus on integration by parts.', completed: false, completedAt: null, createdAt: new Date().toISOString() },
      { id: 't2', title: 'Read chapter on data structures', subjectId: 's2', dueDate: Dates.todayISO(),   priority: 'medium', category: 'Reading',    estimate: 45, notes: 'Arrays, linked lists, and Big-O notation.',       completed: false, completedAt: null, createdAt: new Date().toISOString() },
      { id: 't3', title: 'Lab report: projectile motion',   subjectId: 's3', dueDate: Dates.offsetISO(2),  priority: 'high',   category: 'Project',    estimate: 90, notes: 'Include calculations and error analysis.',          completed: false, completedAt: null, createdAt: new Date().toISOString() },
      { id: 't4', title: 'Essay draft: Hamlet themes',      subjectId: 's4', dueDate: Dates.offsetISO(5),  priority: 'medium', category: 'Assignment', estimate: 75, notes: 'Focus on mortality and indecision.',              completed: false, completedAt: null, createdAt: new Date().toISOString() },
      { id: 't5', title: 'Review linear algebra notes',     subjectId: 's1', dueDate: Dates.offsetISO(-1), priority: 'low',    category: 'Revision',   estimate: 30, notes: 'Matrix transformations and eigenvectors.',          completed: false, completedAt: null, createdAt: new Date().toISOString() },
      { id: 't6', title: 'Set up dev environment',          subjectId: 's2', dueDate: Dates.offsetISO(-3), priority: 'low',    category: 'Practice',   estimate: 40, notes: 'Install compiler and editor extensions.',          completed: true,  completedAt: new Date().toISOString(), createdAt: new Date().toISOString() },
      { id: 't7', title: 'Memorize physics formulas',       subjectId: 's3', dueDate: Dates.offsetISO(3),  priority: 'medium', category: 'Exam Prep',  estimate: 25, notes: 'Kinematics and work-energy theorem.',               completed: true,  completedAt: new Date().toISOString(), createdAt: new Date().toISOString() }
    ];

    const notes = [
      { id: 'n1', title: 'Integration techniques', subjectId: 's1', content: 'Key methods:\n• u-substitution\n• integration by parts (LIATE rule)\n• partial fractions\n\nPractice at least 3 problems of each type before the exam.', tags: ['calculus', 'math'], pinned: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'n2', title: 'Big-O cheat sheet',      subjectId: 's2', content: 'O(1) constant · O(log n) binary search · O(n) linear scan · O(n log n) good sorts · O(n^2) nested loops.\n\nAlways state best/avg/worst case.', tags: ['algorithms', 'cs'], pinned: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    ];

    const sessions = [
      { id: 'ses1', subjectId: 's1', taskId: 't6', durationMinutes: 25, type: 'focus', completedAt: new Date(Date.now() - 3600000 * 2).toISOString(), notes: 'Focus sprint on calculus problems' },
      { id: 'ses2', subjectId: 's2', taskId: '',   durationMinutes: 25, type: 'focus', completedAt: new Date(Date.now() - 3600000 * 26).toISOString(), notes: 'Reviewed data structures' }
    ];

    const activity = [
      { id: 'act1', type: 'task_complete', title: 'Completed "Set up dev environment"', timestamp: new Date(Date.now() - 3600000 * 5).toISOString(), meta: {} },
      { id: 'act2', type: 'session_finish', title: 'Completed 25m Focus session on Mathematics', timestamp: new Date(Date.now() - 3600000 * 2).toISOString(), meta: {} },
      { id: 'act3', type: 'note_create', title: 'Created note "Integration techniques"', timestamp: new Date(Date.now() - 3600000 * 24).toISOString(), meta: {} }
    ];

    const habits = [
      { id: 'h1', name: 'Review class notes', description: 'Quick 15-minute daily recall after lectures', icon: '📝', color: '#7c3aed', frequency: 'daily', targetDays: [0, 1, 2, 3, 4, 5, 6], subjectId: 's1', createdAt: Dates.offsetISO(-14), archived: false },
      { id: 'h2', name: 'Practice coding', description: 'Solve 1 algorithmic or programming problem', icon: '💻', color: '#2563eb', frequency: 'weekdays', targetDays: [1, 3, 5], subjectId: 's2', createdAt: Dates.offsetISO(-14), archived: false },
      { id: 'h3', name: 'Read textbook chapter', description: 'Active reading with margin annotations', icon: '📖', color: '#0d9488', frequency: 'daily', targetDays: [0, 1, 2, 3, 4, 5, 6], subjectId: 's3', createdAt: Dates.offsetISO(-10), archived: false },
      { id: 'h4', name: 'Revise before bed', description: '5-minute reflection on key concepts learned today', icon: '🌙', color: '#db2777', frequency: 'daily', targetDays: [0, 1, 2, 3, 4, 5, 6], subjectId: '', createdAt: Dates.offsetISO(-7), archived: false }
    ];

    const habitCompletions = [
      { id: 'hc1', habitId: 'h1', date: Dates.offsetISO(-2), completedAt: new Date(Date.now() - 86400000 * 2).toISOString() },
      { id: 'hc2', habitId: 'h1', date: Dates.offsetISO(-1), completedAt: new Date(Date.now() - 86400000).toISOString() },
      { id: 'hc3', habitId: 'h1', date: Dates.todayISO(),    completedAt: new Date().toISOString() },
      { id: 'hc4', habitId: 'h3', date: Dates.offsetISO(-1), completedAt: new Date(Date.now() - 86400000).toISOString() }
    ];

    this._write(this.KEYS.subjects, subjects);
    this._write(this.KEYS.tasks, tasks);
    this._write(this.KEYS.habits, habits);
    this._write(this.KEYS.habitCompletions, habitCompletions);
    this._write(this.KEYS.notes, notes);
    this._write(this.KEYS.sessions, sessions);
    this._write(this.KEYS.activity, activity);
    localStorage.setItem(this.KEYS.seeded, '1');
  },

  /** Force-reload starter demo data (Settings → "Reload Starter Demo Data").
      Explicitly remove the seed marker so seedIfEmpty() runs fresh. */
  reseed() {
    this.clearAll();
    localStorage.removeItem(this.KEYS.seeded);
    this.seedIfEmpty();
  },

  /** Wipe all app data without repopulating starter data after refresh. */
  clearAll() {
    Object.values(this.KEYS).forEach(k => localStorage.removeItem(k));
    // Keep an explicit empty-state marker. Without it, the app mistakes a
    // deliberate reset for a first visit and recreates the demo records.
    localStorage.setItem(this.KEYS.seeded, '1');
  }
};

// Seed example data on very first load, before any page renders.
Store.seedIfEmpty();
