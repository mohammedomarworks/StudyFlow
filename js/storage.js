/* ==========================================================================
   storage.js — Data layer
   --------------------------------------------------------------------------
   Two globals are defined here and shared by every page:

     • Dates — timezone-safe date helpers (parse/format/compare). All dates are
               stored as 'YYYY-MM-DD' strings and parsed at LOCAL midnight so a
               task never appears on the wrong calendar day.

     • Store — the only place that touches localStorage. Pages call semantic
               methods (getTasks, saveTask, toggleTask, getStats…) and never
               read the raw keys themselves, keeping data access consistent.
   ========================================================================== */

/* ==========================================================================
   Dates — date utilities
   ========================================================================== */
const Dates = {
  /** Today as a 'YYYY-MM-DD' string in the user's local timezone. */
  todayISO() { return this.toISO(new Date()); },

  /** Convert a Date object to a local 'YYYY-MM-DD' string. */
  toISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  /** Parse 'YYYY-MM-DD' into a Date at LOCAL midnight (avoids UTC shift). */
  parse(iso) {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
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
  }
};

/* ==========================================================================
   Store — localStorage-backed data access
   ========================================================================== */
const Store = {
  KEYS: {
    subjects: 'sp_subjects',
    tasks:    'sp_tasks',
    notes:    'sp_notes',
    settings: 'sp_settings',
    seeded:   'sp_seeded_v1'
  },

  /* ---- low-level read / write (with safe JSON parsing) ----------------- */
  _read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;   // corrupted value → fall back gracefully
    }
  },
  _write(key, value) { localStorage.setItem(key, JSON.stringify(value)); },

  /** Short unique id (timestamp + random) — good enough for local data. */
  uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); },

  /* ========================= SUBJECTS =================================== */
  getSubjects() { return this._read(this.KEYS.subjects, []); },
  getSubject(id) { return this.getSubjects().find(s => s.id === id) || null; },

  /** Insert (no id) or update (existing id) a subject; returns the record. */
  saveSubject(data) {
    const subjects = this.getSubjects();
    if (data.id) {
      const i = subjects.findIndex(s => s.id === data.id);
      if (i > -1) subjects[i] = { ...subjects[i], ...data };
    } else {
      data.id = this.uid();
      data.createdAt = new Date().toISOString();
      subjects.push(data);
    }
    this._write(this.KEYS.subjects, subjects);
    return data;
  },

  /** Delete a subject and unlink it from any tasks/notes. */
  deleteSubject(id) {
    this._write(this.KEYS.subjects, this.getSubjects().filter(s => s.id !== id));
    // Unlink dependents rather than orphaning them.
    const tasks = this.getTasks().map(t => t.subjectId === id ? { ...t, subjectId: '' } : t);
    this._write(this.KEYS.tasks, tasks);
    const notes = this.getNotes().map(n => n.subjectId === id ? { ...n, subjectId: '' } : n);
    this._write(this.KEYS.notes, notes);
  },

  /* =========================== TASKS ==================================== */
  getTasks() { return this._read(this.KEYS.tasks, []); },
  getTask(id) { return this.getTasks().find(t => t.id === id) || null; },

  saveTask(data) {
    const tasks = this.getTasks();
    if (data.id) {
      const i = tasks.findIndex(t => t.id === data.id);
      if (i > -1) tasks[i] = { ...tasks[i], ...data };
    } else {
      data.id = this.uid();
      data.completed = false;
      data.createdAt = new Date().toISOString();
      tasks.push(data);
    }
    this._write(this.KEYS.tasks, tasks);
    return data;
  },

  deleteTask(id) {
    this._write(this.KEYS.tasks, this.getTasks().filter(t => t.id !== id));
  },

  /** Flip a task's completed flag; returns the new state. */
  toggleTask(id) {
    const tasks = this.getTasks();
    const t = tasks.find(x => x.id === id);
    if (!t) return null;
    t.completed = !t.completed;
    t.completedAt = t.completed ? new Date().toISOString() : null;
    this._write(this.KEYS.tasks, tasks);
    return t.completed;
  },

  /* =========================== NOTES ==================================== */
  getNotes() { return this._read(this.KEYS.notes, []); },
  getNote(id) { return this.getNotes().find(n => n.id === id) || null; },

  saveNote(data) {
    const notes = this.getNotes();
    const now = new Date().toISOString();
    if (data.id) {
      const i = notes.findIndex(n => n.id === data.id);
      if (i > -1) notes[i] = { ...notes[i], ...data, updatedAt: now };
    } else {
      data.id = this.uid();
      data.createdAt = now;
      data.updatedAt = now;
      notes.push(data);
    }
    this._write(this.KEYS.notes, notes);
    return data;
  },

  deleteNote(id) {
    this._write(this.KEYS.notes, this.getNotes().filter(n => n.id !== id));
  },

  /* ========================= SETTINGS =================================== */
  getSettings() { return this._read(this.KEYS.settings, { theme: null }); },
  setSetting(key, value) {
    const s = this.getSettings();
    s[key] = value;
    this._write(this.KEYS.settings, s);
  },

  /* ===================== DERIVED STATISTICS ============================= */
  /** Aggregate counts used across the Dashboard and Progress pages. */
  getStats() {
    const tasks = this.getTasks();
    const subjects = this.getSubjects();
    const today = Dates.todayISO();

    const completed = tasks.filter(t => t.completed).length;
    const total = tasks.length;
    const pending = total - completed;
    const overdue = tasks.filter(t => !t.completed && t.dueDate && t.dueDate < today).length;
    const dueToday = tasks.filter(t => !t.completed && t.dueDate === today).length;
    const upcomingExams = subjects.filter(s => s.examDate && s.examDate >= today).length;

    return {
      total, completed, pending, overdue, dueToday, upcomingExams,
      subjects: subjects.length,
      completionRate: total ? Math.round((completed / total) * 100) : 0
    };
  },

  /** Per-subject completion figures for the Progress page. */
  getSubjectProgress() {
    const tasks = this.getTasks();
    return this.getSubjects().map(s => {
      const subTasks = tasks.filter(t => t.subjectId === s.id);
      const done = subTasks.filter(t => t.completed).length;
      return {
        ...s,
        totalTasks: subTasks.length,
        doneTasks: done,
        percent: subTasks.length ? Math.round((done / subTasks.length) * 100) : 0
      };
    });
  },

  /* ======================= SEED (first run) ============================= */
  /** Populate friendly example data the first time the app is opened. */
  seedIfEmpty() {
    if (localStorage.getItem(this.KEYS.seeded)) return;

    const subjects = [
      { id: 's1', name: 'Mathematics',        color: '#7c3aed', teacher: 'Dr. Alan Reed',   examDate: Dates.offsetISO(9)  },
      { id: 's2', name: 'Computer Science',    color: '#2563eb', teacher: 'Prof. Kim Ito',   examDate: Dates.offsetISO(16) },
      { id: 's3', name: 'Physics',             color: '#0d9488', teacher: 'Dr. Sara Osei',   examDate: Dates.offsetISO(4)  },
      { id: 's4', name: 'English Literature',  color: '#db2777', teacher: 'Ms. Lena Park',   examDate: '' }
    ];

    const tasks = [
      { id: 't1', title: 'Complete calculus problem set 5', subjectId: 's1', dueDate: Dates.todayISO(),   priority: 'high',   notes: 'Chapters 4–5, focus on integration by parts.', completed: false, createdAt: new Date().toISOString() },
      { id: 't2', title: 'Read chapter on data structures', subjectId: 's2', dueDate: Dates.todayISO(),   priority: 'medium', notes: 'Arrays, linked lists, and Big-O notation.',       completed: false, createdAt: new Date().toISOString() },
      { id: 't3', title: 'Lab report: projectile motion',   subjectId: 's3', dueDate: Dates.offsetISO(2),  priority: 'high',   notes: '',                                                completed: false, createdAt: new Date().toISOString() },
      { id: 't4', title: 'Essay draft: Hamlet themes',      subjectId: 's4', dueDate: Dates.offsetISO(5),  priority: 'medium', notes: 'Focus on mortality and indecision.',              completed: false, createdAt: new Date().toISOString() },
      { id: 't5', title: 'Review linear algebra notes',     subjectId: 's1', dueDate: Dates.offsetISO(-1), priority: 'low',    notes: '',                                                completed: false, createdAt: new Date().toISOString() },
      { id: 't6', title: 'Set up dev environment',          subjectId: 's2', dueDate: Dates.offsetISO(-3), priority: 'low',    notes: 'Install compiler and editor extensions.',          completed: true,  createdAt: new Date().toISOString() },
      { id: 't7', title: 'Memorize physics formulas',       subjectId: 's3', dueDate: Dates.offsetISO(3),  priority: 'medium', notes: '',                                                completed: true,  createdAt: new Date().toISOString() }
    ];

    const notes = [
      { id: 'n1', title: 'Integration techniques', subjectId: 's1', content: 'Key methods:\n• u-substitution\n• integration by parts (LIATE rule)\n• partial fractions\n\nPractice at least 3 problems of each type before the exam.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'n2', title: 'Big-O cheat sheet',      subjectId: 's2', content: 'O(1) constant · O(log n) binary search · O(n) linear scan · O(n log n) good sorts · O(n^2) nested loops.\n\nAlways state best/avg/worst case.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    ];

    this._write(this.KEYS.subjects, subjects);
    this._write(this.KEYS.tasks, tasks);
    this._write(this.KEYS.notes, notes);
    localStorage.setItem(this.KEYS.seeded, '1');
  },

  /** Wipe all app data (used by the About page "reset" action). */
  clearAll() {
    Object.values(this.KEYS).forEach(k => localStorage.removeItem(k));
  }
};

// Seed example data on very first load, before any page renders.
Store.seedIfEmpty();
