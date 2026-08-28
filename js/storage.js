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
    if (!iso) return null;
    const parts = iso.split('-').map(Number);
    if (parts.length < 3 || parts.some(isNaN)) return null;
    const [y, m, d] = parts;
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

  /* ========================= ACTIVITY LOG ============================== */
  getActivity(limit = 20) {
    const list = this._read(this.KEYS.activity, []);
    return list.slice(0, limit);
  },

  logActivity(type, title, meta = {}) {
    const list = this._read(this.KEYS.activity, []);
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
    return this._read(this.KEYS.subjects, []);
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
    const list = this._read(this.KEYS.tasks, []);
    // Normalize missing fields for backward compatibility
    return list.map(t => ({
      id: t.id,
      title: t.title || 'Untitled task',
      subjectId: t.subjectId || '',
      dueDate: t.dueDate || Dates.todayISO(),
      priority: t.priority || 'medium',
      estimate: Number(t.estimate) || 0,
      category: t.category || 'General',
      notes: t.notes || '',
      completed: Boolean(t.completed),
      completedAt: t.completedAt || (t.completed ? t.createdAt || new Date().toISOString() : null),
      createdAt: t.createdAt || new Date().toISOString()
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

  /* =========================== NOTES ==================================== */
  getNotes() {
    const list = this._read(this.KEYS.notes, []);
    return list.map(n => ({
      id: n.id,
      title: n.title || 'Untitled Note',
      subjectId: n.subjectId || '',
      content: n.content || '',
      tags: Array.isArray(n.tags) ? n.tags : [],
      createdAt: n.createdAt || new Date().toISOString(),
      updatedAt: n.updatedAt || n.createdAt || new Date().toISOString()
    }));
  },

  getNote(id) {
    if (!id) return null;
    return this.getNotes().find(n => n.id === id) || null;
  },

  saveNote(data) {
    const notes = this.getNotes();
    const now = new Date().toISOString();
    if (data.id) {
      const i = notes.findIndex(n => n.id === data.id);
      if (i > -1) {
        notes[i] = { ...notes[i], ...data, updatedAt: now };
      }
    } else {
      data.id = this.uid();
      data.createdAt = now;
      data.updatedAt = now;
      notes.push(data);
      this.logActivity('note_create', `Created note "${data.title}"`, { noteId: data.id });
    }
    this._write(this.KEYS.notes, notes);
    return data;
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
    const list = this._read(this.KEYS.sessions, []);
    return list.map(s => ({
      id: s.id,
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
      data.completedAt = data.completedAt || new Date().toISOString();
      sessions.unshift(data);
    } else {
      const i = sessions.findIndex(s => s.id === data.id);
      if (i > -1) sessions[i] = { ...sessions[i], ...data };
    }
    this._write(this.KEYS.sessions, sessions);

    if (data.type === 'focus') {
      const subj = this.getSubject(data.subjectId);
      const label = subj ? `Focus session on ${subj.name}` : 'Focus study session';
      this.logActivity('session_finish', `Completed ${data.durationMinutes}m ${label}`, {
        duration: data.durationMinutes,
        subjectId: data.subjectId
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
    const todaySessions = sessions.filter(s => (s.completedAt || '').startsWith(today));
    const todayMinutes = todaySessions.reduce((acc, s) => acc + (s.durationMinutes || 0), 0);

    // Calculate active streak days
    const uniqueDays = new Set(sessions.map(s => (s.completedAt || '').slice(0, 10)).filter(Boolean));
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

    return {
      totalMinutes,
      totalHours: Number((totalMinutes / 60).toFixed(1)),
      todayMinutes,
      totalSessions: sessions.length,
      todaySessionsCount: todaySessions.length,
      streakDays: streak
    };
  },

  /* ========================= SETTINGS =================================== */
  getSettings() {
    const defaults = {
      theme: 'system', // 'light' | 'dark' | 'system'
      pomodoro: {
        focusTime: 25,
        shortBreak: 5,
        longBreak: 15,
        sound: true,
        autoBreak: false
      }
    };
    const s = this._read(this.KEYS.settings, {});
    return {
      ...defaults,
      ...s,
      pomodoro: { ...defaults.pomodoro, ...(s.pomodoro || {}) }
    };
  },

  setSetting(key, value) {
    const s = this.getSettings();
    s[key] = value;
    this._write(this.KEYS.settings, s);
  },

  saveSettings(newSettings) {
    const s = { ...this.getSettings(), ...newSettings };
    this._write(this.KEYS.settings, s);
    return s;
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

  /* ===================== BACKUP & RESTORE =============================== */
  exportJSON() {
    const data = {
      version: '1.2.0',
      exportedAt: new Date().toISOString(),
      subjects: this.getSubjects(),
      tasks: this.getTasks(),
      notes: this.getNotes(),
      sessions: this.getSessions(),
      activity: this.getActivity(50),
      settings: this.getSettings()
    };
    return JSON.stringify(data, null, 2);
  },

  importJSON(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (!data || typeof data !== 'object') {
        return { success: false, error: 'Invalid backup file format.' };
      }

      if (Array.isArray(data.subjects)) this._write(this.KEYS.subjects, data.subjects);
      if (Array.isArray(data.tasks)) this._write(this.KEYS.tasks, data.tasks);
      if (Array.isArray(data.notes)) this._write(this.KEYS.notes, data.notes);
      if (Array.isArray(data.sessions)) this._write(this.KEYS.sessions, data.sessions);
      if (Array.isArray(data.activity)) this._write(this.KEYS.activity, data.activity);
      if (data.settings && typeof data.settings === 'object') this._write(this.KEYS.settings, data.settings);

      return {
        success: true,
        counts: {
          subjects: (data.subjects || []).length,
          tasks: (data.tasks || []).length,
          notes: (data.notes || []).length,
          sessions: (data.sessions || []).length
        }
      };
    } catch (e) {
      return { success: false, error: 'Failed to parse JSON file: ' + e.message };
    }
  },

  /* ======================= SEED (first run) ============================= */
  /** Populate friendly example data the first time the app is opened */
  seedIfEmpty() {
    if (localStorage.getItem(this.KEYS.seeded)) return;

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
      { id: 'n1', title: 'Integration techniques', subjectId: 's1', content: 'Key methods:\n• u-substitution\n• integration by parts (LIATE rule)\n• partial fractions\n\nPractice at least 3 problems of each type before the exam.', tags: ['calculus', 'math'], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'n2', title: 'Big-O cheat sheet',      subjectId: 's2', content: 'O(1) constant · O(log n) binary search · O(n) linear scan · O(n log n) good sorts · O(n^2) nested loops.\n\nAlways state best/avg/worst case.', tags: ['algorithms', 'cs'], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
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

    this._write(this.KEYS.subjects, subjects);
    this._write(this.KEYS.tasks, tasks);
    this._write(this.KEYS.notes, notes);
    this._write(this.KEYS.sessions, sessions);
    this._write(this.KEYS.activity, activity);
    localStorage.setItem(this.KEYS.seeded, '1');
  },

  /** Wipe all app data */
  clearAll() {
    Object.values(this.KEYS).forEach(k => localStorage.removeItem(k));
  }
};

// Seed example data on very first load, before any page renders.
Store.seedIfEmpty();

