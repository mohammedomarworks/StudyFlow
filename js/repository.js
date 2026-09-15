/* ==========================================================================
   repository.js — Repository Abstraction Layer (StudyFlow v2.0 Phase C)
   --------------------------------------------------------------------------
   Defines the contract and runtime boundary for dual-tier storage:

     UI Layer / Page Controllers
        ↓
     Store Facade (Sync API for v1.5 UI compatibility)
        ↓
     Repository Factory
        ├── LocalRepository (localStorage sp_* keys)
        └── CloudRepository (Supabase PostgreSQL + RLS + isolated cloud cache)

   Storage Modes:
     1. 'local': Unauthenticated users or authenticated users prior to migration.
     2. 'cloud': Authenticated users who have migrated planner data.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.StudyFlowRepository = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /**
   * BaseRepository — Interface definition for data operations
   */
  class BaseRepository {
    // Subjects
    async getSubjects() { throw new Error('Method not implemented.'); }
    async getSubject(id) { throw new Error('Method not implemented.'); }
    async saveSubject(data) { throw new Error('Method not implemented.'); }
    async deleteSubject(id) { throw new Error('Method not implemented.'); }

    // Tasks
    async getTasks() { throw new Error('Method not implemented.'); }
    async getTask(id) { throw new Error('Method not implemented.'); }
    async saveTask(data) { throw new Error('Method not implemented.'); }
    async deleteTask(id) { throw new Error('Method not implemented.'); }
    async toggleTask(id) { throw new Error('Method not implemented.'); }

    // Notes
    async getNotes() { throw new Error('Method not implemented.'); }
    async getNote(id) { throw new Error('Method not implemented.'); }
    async saveNote(data) { throw new Error('Method not implemented.'); }
    async deleteNote(id) { throw new Error('Method not implemented.'); }
    async togglePinNote(id) { throw new Error('Method not implemented.'); }

    // Habits
    async getHabits(includeArchived) { throw new Error('Method not implemented.'); }
    async getHabit(id) { throw new Error('Method not implemented.'); }
    async saveHabit(data) { throw new Error('Method not implemented.'); }
    async archiveHabit(id) { throw new Error('Method not implemented.'); }
    async restoreHabit(id) { throw new Error('Method not implemented.'); }
    async deleteHabit(id) { throw new Error('Method not implemented.'); }

    // Habit Completions
    async getHabitCompletions(habitId) { throw new Error('Method not implemented.'); }
    async toggleHabitCompletion(habitId, dateISO) { throw new Error('Method not implemented.'); }
    async setHabitCompletion(habitId, dateISO, completed) { throw new Error('Method not implemented.'); }

    // Study Sessions
    async getSessions() { throw new Error('Method not implemented.'); }
    async saveSession(data) { throw new Error('Method not implemented.'); }
    async deleteSession(id) { throw new Error('Method not implemented.'); }

    // Activity
    async getActivity(limit) { throw new Error('Method not implemented.'); }
    async logActivity(type, title, meta) { throw new Error('Method not implemented.'); }

    // Settings
    async getSettings() { throw new Error('Method not implemented.'); }
    async saveSettings(settings) { throw new Error('Method not implemented.'); }
  }

  /**
   * LocalRepository — Delegates to the existing synchronous Store API
   */
  class LocalRepository extends BaseRepository {
    constructor(storeInstance) {
      super();
      this._store = storeInstance || (typeof window !== 'undefined' ? window.Store : null);
    }

    _getStore() {
      if (this._store) return this._store;
      if (typeof window !== 'undefined' && window.Store) return window.Store;
      if (typeof global !== 'undefined' && global.Store) return global.Store;
      throw new Error('Local Store is not available in current environment.');
    }

    // Subjects
    async getSubjects() { return this._getStore().getSubjects(); }
    async getSubject(id) { return this._getStore().getSubject(id); }
    async saveSubject(data) { return this._getStore().saveSubject(data); }
    async deleteSubject(id) { return this._getStore().deleteSubject(id); }

    // Tasks
    async getTasks() { return this._getStore().getTasks(); }
    async getTask(id) { return this._getStore().getTask(id); }
    async saveTask(data) { return this._getStore().saveTask(data); }
    async deleteTask(id) { return this._getStore().deleteTask(id); }
    async toggleTask(id) { return this._getStore().toggleTask(id); }

    // Notes
    async getNotes() { return this._getStore().getNotes(); }
    async getNote(id) { return this._getStore().getNote(id); }
    async saveNote(data) { return this._getStore().saveNote(data); }
    async deleteNote(id) { return this._getStore().deleteNote(id); }
    async togglePinNote(id) { return this._getStore().togglePinNote(id); }

    // Habits
    async getHabits(includeArchived = false) { return this._getStore().getHabits(includeArchived); }
    async getHabit(id) { return this._getStore().getHabit(id); }
    async saveHabit(data) { return this._getStore().saveHabit(data); }
    async archiveHabit(id) { return this._getStore().archiveHabit(id); }
    async restoreHabit(id) { return this._getStore().restoreHabit(id); }
    async deleteHabit(id) { return this._getStore().deleteHabit(id); }

    // Habit Completions
    async getHabitCompletions(habitId = null) { return this._getStore().getHabitCompletions(habitId); }
    async toggleHabitCompletion(habitId, dateISO) { return this._getStore().toggleHabitCompletion(habitId, dateISO); }
    async setHabitCompletion(habitId, dateISO, completed) { return this._getStore().setHabitCompletion(habitId, dateISO, completed); }

    // Study Sessions
    async getSessions() { return this._getStore().getSessions(); }
    async saveSession(data) { return this._getStore().saveSession(data); }
    async deleteSession(id) { return this._getStore().deleteSession(id); }

    // Activity
    async getActivity(limit = 20) { return this._getStore().getActivity(limit); }
    async logActivity(type, title, meta = {}) { return this._getStore().logActivity(type, title, meta); }

    // Settings
    async getSettings() { return this._getStore().getSettings(); }
    async saveSettings(settings) { return this._getStore().saveSettings(settings); }
  }

  /**
   * CloudRepository — Supabase PostgreSQL Persistent Implementation (Phase C)
   */
  class CloudRepository extends BaseRepository {
    constructor(supabaseClient) {
      super();
      this._client = supabaseClient || null;
    }

    _getClient() {
      if (this._client) return this._client;
      if (typeof window !== 'undefined' && window.StudyFlowSupabase) {
        return window.StudyFlowSupabase.getClient();
      }
      if (typeof global !== 'undefined' && global.StudyFlowSupabase) {
        return global.StudyFlowSupabase.getClient();
      }
      throw new Error('Supabase client is not initialized or configured.');
    }

    async _getUser() {
      const client = this._getClient();
      if (!client || !client.auth) {
        throw new Error('Supabase client authentication is not available.');
      }
      const { data, error } = await client.auth.getUser();
      if (error || !data || !data.user) {
        throw new Error('User is not authenticated.');
      }
      return data.user;
    }

    /* ---- Entity Mappers (DB Snake_Case <-> JS CamelCase) ---------------- */
    _fromDbSubject(row) {
      if (!row) return null;
      return {
        id: row.id,
        name: row.name || 'Untitled Subject',
        code: row.code || '',
        teacher: row.teacher || '',
        color: row.color || '#7c3aed',
        examDate: row.exam_date || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at || row.created_at
      };
    }

    _toDbSubject(data, userId) {
      return {
        user_id: userId,
        name: (typeof data.name === 'string' && data.name.trim()) ? data.name.trim() : 'Untitled Subject',
        code: (typeof data.code === 'string' && data.code.trim()) ? data.code.trim() : null,
        teacher: (typeof data.teacher === 'string' && data.teacher.trim()) ? data.teacher.trim() : null,
        color: (typeof data.color === 'string' && data.color.trim()) ? data.color.trim() : '#7c3aed',
        exam_date: (typeof data.examDate === 'string' && data.examDate.trim()) ? data.examDate.trim() : null,
        created_at: data.createdAt || new Date().toISOString()
      };
    }

    _fromDbTask(row) {
      if (!row) return null;
      return {
        id: row.id,
        title: row.title || 'Untitled Task',
        notes: row.notes || '',
        category: row.category || 'General',
        priority: row.priority || 'medium',
        dueDate: row.due_date || '',
        estimate: Number(row.estimate_minutes) || 0,
        completed: Boolean(row.completed),
        completedAt: row.completed_at || null,
        subjectId: row.subject_id || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at || row.created_at
      };
    }

    _toDbTask(data, userId) {
      return {
        user_id: userId,
        subject_id: (data.subjectId && typeof data.subjectId === 'string' && data.subjectId.trim()) ? data.subjectId.trim() : null,
        title: (typeof data.title === 'string' && data.title.trim()) ? data.title.trim() : 'Untitled Task',
        notes: (typeof data.notes === 'string' && data.notes.trim()) ? data.notes.trim() : null,
        category: (typeof data.category === 'string' && data.category.trim()) ? data.category.trim() : 'General',
        priority: ['high', 'medium', 'low'].includes(data.priority) ? data.priority : 'medium',
        due_date: (typeof data.dueDate === 'string' && data.dueDate.trim()) ? data.dueDate.trim() : null,
        estimate_minutes: Number(data.estimate) || 0,
        completed: Boolean(data.completed),
        completed_at: data.completed ? (data.completedAt || new Date().toISOString()) : null,
        created_at: data.createdAt || new Date().toISOString()
      };
    }

    _fromDbNote(row) {
      if (!row) return null;
      return {
        id: row.id,
        title: row.title || 'Untitled Note',
        content: row.content || '',
        tags: Array.isArray(row.tags) ? row.tags : [],
        pinned: Boolean(row.pinned),
        subjectId: row.subject_id || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at || row.created_at
      };
    }

    _toDbNote(data, userId) {
      return {
        user_id: userId,
        subject_id: (data.subjectId && typeof data.subjectId === 'string' && data.subjectId.trim()) ? data.subjectId.trim() : null,
        title: (typeof data.title === 'string' && data.title.trim()) ? data.title.trim() : 'Untitled Note',
        content: typeof data.content === 'string' ? data.content : '',
        tags: Array.isArray(data.tags) ? data.tags.filter(t => typeof t === 'string') : [],
        pinned: Boolean(data.pinned),
        created_at: data.createdAt || new Date().toISOString(),
        updated_at: data.updatedAt || new Date().toISOString()
      };
    }

    _fromDbHabit(row) {
      if (!row) return null;
      return {
        id: row.id,
        name: row.name || 'Untitled Habit',
        description: row.description || '',
        icon: row.icon || '⚡',
        color: row.color || '#7c3aed',
        frequency: row.frequency || 'daily',
        targetDays: Array.isArray(row.target_days) ? row.target_days : [0, 1, 2, 3, 4, 5, 6],
        subjectId: row.subject_id || '',
        archived: Boolean(row.archived),
        createdAt: row.created_at,
        updatedAt: row.updated_at || row.created_at
      };
    }

    _toDbHabit(data, userId) {
      const targetDays = Array.isArray(data.targetDays)
        ? data.targetDays.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
        : [0, 1, 2, 3, 4, 5, 6];

      return {
        user_id: userId,
        subject_id: (data.subjectId && typeof data.subjectId === 'string' && data.subjectId.trim()) ? data.subjectId.trim() : null,
        name: (typeof data.name === 'string' && data.name.trim()) ? data.name.trim() : 'Untitled Habit',
        description: (typeof data.description === 'string' && data.description.trim()) ? data.description.trim() : null,
        icon: (typeof data.icon === 'string' && data.icon.trim()) ? data.icon.trim() : '⚡',
        color: (typeof data.color === 'string' && data.color.trim()) ? data.color.trim() : '#7c3aed',
        frequency: data.frequency === 'weekdays' ? 'weekdays' : 'daily',
        target_days: targetDays,
        archived: Boolean(data.archived),
        created_at: data.createdAt || new Date().toISOString()
      };
    }

    _fromDbCompletion(row) {
      if (!row) return null;
      return {
        id: row.id,
        habitId: row.habit_id,
        date: row.date,
        completedAt: row.completed_at
      };
    }

    _fromDbSession(row) {
      if (!row) return null;
      return {
        id: row.id,
        subjectId: row.subject_id || '',
        taskId: row.task_id || '',
        type: row.type || 'focus',
        durationMinutes: Number(row.duration_minutes) || 25,
        notes: row.notes || '',
        completedAt: row.completed_at,
        createdAt: row.created_at || row.completed_at
      };
    }

    _toDbSession(data, userId) {
      return {
        user_id: userId,
        subject_id: (data.subjectId && typeof data.subjectId === 'string' && data.subjectId.trim()) ? data.subjectId.trim() : null,
        task_id: (data.taskId && typeof data.taskId === 'string' && data.taskId.trim()) ? data.taskId.trim() : null,
        type: data.type === 'break' ? 'break' : 'focus',
        duration_minutes: Math.max(1, Number(data.durationMinutes) || 25),
        notes: (typeof data.notes === 'string' && data.notes.trim()) ? data.notes.trim() : null,
        completed_at: data.completedAt || new Date().toISOString()
      };
    }

    _fromDbSettings(row) {
      const defaults = {
        theme: 'system',
        pomodoro: { focus: 25, shortBreak: 5, longBreak: 15, sound: true, autoBreak: false, dailyGoal: 120 },
        preferences: { confirmDelete: true, defaultTaskSort: 'due-asc', motion: 'system' },
        lastExportAt: null
      };
      if (!row) return defaults;
      return {
        theme: ['light', 'dark', 'system'].includes(row.theme) ? row.theme : defaults.theme,
        pomodoro: { ...defaults.pomodoro, ...(row.pomodoro || {}) },
        preferences: { ...defaults.preferences, ...(row.preferences || {}) },
        lastExportAt: row.last_export_at || null,
        updatedAt: row.updated_at || row.created_at
      };
    }

    _toDbSettings(data, userId) {
      const current = data || {};
      return {
        user_id: userId,
        theme: ['light', 'dark', 'system'].includes(current.theme) ? current.theme : 'system',
        pomodoro: current.pomodoro || { focus: 25, shortBreak: 5, longBreak: 15, sound: true, autoBreak: false, dailyGoal: 120 },
        preferences: current.preferences || { confirmDelete: true, defaultTaskSort: 'due-asc', motion: 'system' },
        last_export_at: current.lastExportAt || null,
        updated_at: new Date().toISOString()
      };
    }

    /* ---- Cloud Cache Synchronization Helper ----------------------------- */
    _writeCache(key, data, userId) {
      if (typeof localStorage === 'undefined' || !userId) return;
      try {
        localStorage.setItem(`sp_cloud_${key}_${userId}`, JSON.stringify(data));
      } catch (e) {
        console.warn('StudyFlow CloudRepository cache write error:', e);
      }
    }

    async hydrateCache(userId) {
      if (!userId) {
        const u = await this._getUser();
        userId = u.id;
      }
      const [subjects, tasks, notes, habits, completions, sessions, settings] = await Promise.all([
        this.getSubjects(),
        this.getTasks(),
        this.getNotes(),
        this.getHabits(true),
        this.getHabitCompletions(),
        this.getSessions(),
        this.getSettings()
      ]);

      this._writeCache('sp_subjects', subjects, userId);
      this._writeCache('sp_tasks', tasks, userId);
      this._writeCache('sp_notes', notes, userId);
      this._writeCache('sp_habits', habits, userId);
      this._writeCache('sp_habit_completions', completions, userId);
      this._writeCache('sp_sessions', sessions, userId);
      this._writeCache('sp_settings', settings, userId);

      return { subjects, tasks, notes, habits, completions, sessions, settings };
    }

    // ========================================================================
    // SUBJECTS CRUD
    // ========================================================================
    async getSubjects() {
      const user = await this._getUser();
      const { data, error } = await this._getClient()
        .from('subjects')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });

      if (error) throw new Error(`Cloud getSubjects error: ${error.message}`);
      const list = (data || []).map(r => this._fromDbSubject(r));
      this._writeCache('sp_subjects', list, user.id);
      return list;
    }

    async getSubject(id) {
      if (!id) return null;
      const user = await this._getUser();
      const { data, error } = await this._getClient()
        .from('subjects')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw new Error(`Cloud getSubject error: ${error.message}`);
      return this._fromDbSubject(data);
    }

    async saveSubject(data) {
      const user = await this._getUser();
      const client = this._getClient();
      const payload = this._toDbSubject(data, user.id);

      let savedRow;
      if (data.id && typeof data.id === 'string' && data.id.includes('-')) {
        // Update existing UUID record
        const { data: updated, error } = await client
          .from('subjects')
          .update(payload)
          .eq('id', data.id)
          .eq('user_id', user.id)
          .select()
          .single();
        if (error) throw new Error(`Cloud saveSubject update error: ${error.message}`);
        savedRow = updated;
      } else {
        // Insert new record
        const { data: inserted, error } = await client
          .from('subjects')
          .insert(payload)
          .select()
          .single();
        if (error) throw new Error(`Cloud saveSubject insert error: ${error.message}`);
        savedRow = inserted;
      }

      const normalized = this._fromDbSubject(savedRow);
      // Refresh cache
      this.getSubjects().catch(() => {});
      return normalized;
    }

    async deleteSubject(id) {
      if (!id) return false;
      const user = await this._getUser();
      const { error } = await this._getClient()
        .from('subjects')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);

      if (error) throw new Error(`Cloud deleteSubject error: ${error.message}`);
      this.getSubjects().catch(() => {});
      return true;
    }

    // ========================================================================
    // TASKS CRUD
    // ========================================================================
    async getTasks() {
      const user = await this._getUser();
      const { data, error } = await this._getClient()
        .from('tasks')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });

      if (error) throw new Error(`Cloud getTasks error: ${error.message}`);
      const list = (data || []).map(r => this._fromDbTask(r));
      this._writeCache('sp_tasks', list, user.id);
      return list;
    }

    async getTask(id) {
      if (!id) return null;
      const user = await this._getUser();
      const { data, error } = await this._getClient()
        .from('tasks')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw new Error(`Cloud getTask error: ${error.message}`);
      return this._fromDbTask(data);
    }

    async saveTask(data) {
      const user = await this._getUser();
      const client = this._getClient();
      const payload = this._toDbTask(data, user.id);

      let savedRow;
      if (data.id && typeof data.id === 'string' && data.id.includes('-')) {
        const { data: updated, error } = await client
          .from('tasks')
          .update(payload)
          .eq('id', data.id)
          .eq('user_id', user.id)
          .select()
          .single();
        if (error) throw new Error(`Cloud saveTask update error: ${error.message}`);
        savedRow = updated;
      } else {
        const { data: inserted, error } = await client
          .from('tasks')
          .insert(payload)
          .select()
          .single();
        if (error) throw new Error(`Cloud saveTask insert error: ${error.message}`);
        savedRow = inserted;
      }

      const normalized = this._fromDbTask(savedRow);
      this.getTasks().catch(() => {});
      return normalized;
    }

    async deleteTask(id) {
      if (!id) return false;
      const user = await this._getUser();
      const { error } = await this._getClient()
        .from('tasks')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);

      if (error) throw new Error(`Cloud deleteTask error: ${error.message}`);
      this.getTasks().catch(() => {});
      return true;
    }

    async toggleTask(id) {
      const task = await this.getTask(id);
      if (!task) return null;

      const newCompleted = !task.completed;
      const newCompletedAt = newCompleted ? new Date().toISOString() : null;

      const user = await this._getUser();
      const { error } = await this._getClient()
        .from('tasks')
        .update({
          completed: newCompleted,
          completed_at: newCompletedAt
        })
        .eq('id', id)
        .eq('user_id', user.id);

      if (error) throw new Error(`Cloud toggleTask error: ${error.message}`);
      this.getTasks().catch(() => {});
      return newCompleted;
    }

    // ========================================================================
    // NOTES CRUD
    // ========================================================================
    async getNotes() {
      const user = await this._getUser();
      const { data, error } = await this._getClient()
        .from('notes')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw new Error(`Cloud getNotes error: ${error.message}`);
      const list = (data || []).map(r => this._fromDbNote(r));
      this._writeCache('sp_notes', list, user.id);
      return list;
    }

    async getNote(id) {
      if (!id) return null;
      const user = await this._getUser();
      const { data, error } = await this._getClient()
        .from('notes')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw new Error(`Cloud getNote error: ${error.message}`);
      return this._fromDbNote(data);
    }

    async saveNote(data) {
      const user = await this._getUser();
      const client = this._getClient();
      const payload = this._toDbNote(data, user.id);

      let savedRow;
      if (data.id && typeof data.id === 'string' && data.id.includes('-')) {
        const { data: updated, error } = await client
          .from('notes')
          .update(payload)
          .eq('id', data.id)
          .eq('user_id', user.id)
          .select()
          .single();
        if (error) throw new Error(`Cloud saveNote update error: ${error.message}`);
        savedRow = updated;
      } else {
        const { data: inserted, error } = await client
          .from('notes')
          .insert(payload)
          .select()
          .single();
        if (error) throw new Error(`Cloud saveNote insert error: ${error.message}`);
        savedRow = inserted;
      }

      const normalized = this._fromDbNote(savedRow);
      this.getNotes().catch(() => {});
      return normalized;
    }

    async deleteNote(id) {
      if (!id) return false;
      const user = await this._getUser();
      const { error } = await this._getClient()
        .from('notes')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);

      if (error) throw new Error(`Cloud deleteNote error: ${error.message}`);
      this.getNotes().catch(() => {});
      return true;
    }

    async togglePinNote(id) {
      const note = await this.getNote(id);
      if (!note) return false;

      const newPinned = !note.pinned;
      const user = await this._getUser();
      const { error } = await this._getClient()
        .from('notes')
        .update({ pinned: newPinned })
        .eq('id', id)
        .eq('user_id', user.id);

      if (error) throw new Error(`Cloud togglePinNote error: ${error.message}`);
      this.getNotes().catch(() => {});
      return newPinned;
    }

    // ========================================================================
    // HABITS CRUD
    // ========================================================================
    async getHabits(includeArchived = false) {
      const user = await this._getUser();
      let query = this._getClient()
        .from('habits')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });

      if (!includeArchived) {
        query = query.eq('archived', false);
      }

      const { data, error } = await query;
      if (error) throw new Error(`Cloud getHabits error: ${error.message}`);
      const list = (data || []).map(r => this._fromDbHabit(r));
      this._writeCache('sp_habits', list, user.id);
      return list;
    }

    async getHabit(id) {
      if (!id) return null;
      const user = await this._getUser();
      const { data, error } = await this._getClient()
        .from('habits')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw new Error(`Cloud getHabit error: ${error.message}`);
      return this._fromDbHabit(data);
    }

    async saveHabit(data) {
      const user = await this._getUser();
      const client = this._getClient();
      const payload = this._toDbHabit(data, user.id);

      let savedRow;
      if (data.id && typeof data.id === 'string' && data.id.includes('-')) {
        const { data: updated, error } = await client
          .from('habits')
          .update(payload)
          .eq('id', data.id)
          .eq('user_id', user.id)
          .select()
          .single();
        if (error) throw new Error(`Cloud saveHabit update error: ${error.message}`);
        savedRow = updated;
      } else {
        const { data: inserted, error } = await client
          .from('habits')
          .insert(payload)
          .select()
          .single();
        if (error) throw new Error(`Cloud saveHabit insert error: ${error.message}`);
        savedRow = inserted;
      }

      const normalized = this._fromDbHabit(savedRow);
      this.getHabits(true).catch(() => {});
      return normalized;
    }

    async archiveHabit(id) {
      const user = await this._getUser();
      const { error } = await this._getClient()
        .from('habits')
        .update({ archived: true })
        .eq('id', id)
        .eq('user_id', user.id);

      if (error) throw new Error(`Cloud archiveHabit error: ${error.message}`);
      this.getHabits(true).catch(() => {});
      return true;
    }

    async restoreHabit(id) {
      const user = await this._getUser();
      const { error } = await this._getClient()
        .from('habits')
        .update({ archived: false })
        .eq('id', id)
        .eq('user_id', user.id);

      if (error) throw new Error(`Cloud restoreHabit error: ${error.message}`);
      this.getHabits(true).catch(() => {});
      return true;
    }

    async deleteHabit(id) {
      if (!id) return false;
      const user = await this._getUser();
      const { error } = await this._getClient()
        .from('habits')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);

      if (error) throw new Error(`Cloud deleteHabit error: ${error.message}`);
      this.getHabits(true).catch(() => {});
      return true;
    }

    // ========================================================================
    // HABIT COMPLETIONS
    // ========================================================================
    async getHabitCompletions(habitId = null) {
      const user = await this._getUser();
      let query = this._getClient()
        .from('habit_completions')
        .select('*')
        .eq('user_id', user.id)
        .order('date', { ascending: true });

      if (habitId) {
        query = query.eq('habit_id', habitId);
      }

      const { data, error } = await query;
      if (error) throw new Error(`Cloud getHabitCompletions error: ${error.message}`);
      const list = (data || []).map(r => this._fromDbCompletion(r));
      if (!habitId) {
        this._writeCache('sp_habit_completions', list, user.id);
      }
      return list;
    }

    async toggleHabitCompletion(habitId, dateISO) {
      if (!habitId || !dateISO) return null;
      const user = await this._getUser();
      const client = this._getClient();

      // Check existing
      const { data: existing, error: checkErr } = await client
        .from('habit_completions')
        .select('id')
        .eq('user_id', user.id)
        .eq('habit_id', habitId)
        .eq('date', dateISO)
        .maybeSingle();

      if (checkErr) throw new Error(`Cloud toggleHabitCompletion check error: ${checkErr.message}`);

      if (existing) {
        // Delete completion
        const { error: delErr } = await client
          .from('habit_completions')
          .delete()
          .eq('id', existing.id)
          .eq('user_id', user.id);
        if (delErr) throw new Error(`Cloud toggleHabitCompletion delete error: ${delErr.message}`);
        this.getHabitCompletions().catch(() => {});
        return false;
      } else {
        // Insert completion
        const { error: insErr } = await client
          .from('habit_completions')
          .insert({
            user_id: user.id,
            habit_id: habitId,
            date: dateISO,
            completed_at: new Date().toISOString()
          });
        if (insErr) throw new Error(`Cloud toggleHabitCompletion insert error: ${insErr.message}`);
        this.getHabitCompletions().catch(() => {});
        return true;
      }
    }

    async setHabitCompletion(habitId, dateISO, completed = true) {
      if (!habitId || !dateISO) return false;
      const user = await this._getUser();
      const client = this._getClient();

      if (completed) {
        const { error } = await client
          .from('habit_completions')
          .upsert({
            user_id: user.id,
            habit_id: habitId,
            date: dateISO,
            completed_at: new Date().toISOString()
          }, { onConflict: 'habit_id, date' });
        if (error) throw new Error(`Cloud setHabitCompletion error: ${error.message}`);
        this.getHabitCompletions().catch(() => {});
        return true;
      } else {
        const { error } = await client
          .from('habit_completions')
          .delete()
          .eq('habit_id', habitId)
          .eq('date', dateISO)
          .eq('user_id', user.id);
        if (error) throw new Error(`Cloud setHabitCompletion error: ${error.message}`);
        this.getHabitCompletions().catch(() => {});
        return false;
      }
    }

    // ========================================================================
    // STUDY SESSIONS
    // ========================================================================
    async getSessions() {
      const user = await this._getUser();
      const { data, error } = await this._getClient()
        .from('study_sessions')
        .select('*')
        .eq('user_id', user.id)
        .order('completed_at', { ascending: false });

      if (error) throw new Error(`Cloud getSessions error: ${error.message}`);
      const list = (data || []).map(r => this._fromDbSession(r));
      this._writeCache('sp_sessions', list, user.id);
      return list;
    }

    async saveSession(data) {
      const user = await this._getUser();
      const payload = this._toDbSession(data, user.id);
      const { data: inserted, error } = await this._getClient()
        .from('study_sessions')
        .insert(payload)
        .select()
        .single();

      if (error) throw new Error(`Cloud saveSession error: ${error.message}`);
      const normalized = this._fromDbSession(inserted);
      this.getSessions().catch(() => {});
      return normalized;
    }

    async deleteSession(id) {
      if (!id) return false;
      const user = await this._getUser();
      const { error } = await this._getClient()
        .from('study_sessions')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);

      if (error) throw new Error(`Cloud deleteSession error: ${error.message}`);
      this.getSessions().catch(() => {});
      return true;
    }

    // ========================================================================
    // SETTINGS
    // ========================================================================
    async getSettings() {
      const user = await this._getUser();
      const { data, error } = await this._getClient()
        .from('settings')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw new Error(`Cloud getSettings error: ${error.message}`);
      const normalized = this._fromDbSettings(data);
      this._writeCache('sp_settings', normalized, user.id);
      return normalized;
    }

    async saveSettings(settings = {}) {
      const user = await this._getUser();
      const current = await this.getSettings();
      const merged = {
        theme: settings.theme || current.theme,
        pomodoro: { ...(current.pomodoro || {}), ...(settings.pomodoro || {}) },
        preferences: { ...(current.preferences || {}), ...(settings.preferences || {}) },
        lastExportAt: settings.lastExportAt || current.lastExportAt
      };

      const payload = this._toDbSettings(merged, user.id);
      const { data, error } = await this._getClient()
        .from('settings')
        .upsert(payload, { onConflict: 'user_id' })
        .select()
        .single();

      if (error) throw new Error(`Cloud saveSettings error: ${error.message}`);
      const normalized = this._fromDbSettings(data);
      this._writeCache('sp_settings', normalized, user.id);
      return normalized;
    }
  }

  /**
   * RepositoryFactory — Returns and manages active repository instance
   */
  const RepositoryFactory = {
    _instances: {},
    _mode: 'local', // 'local' | 'cloud'
    _activeUserId: null,
    _listeners: new Set(),

    getMode() {
      return this._mode;
    },

    getActiveUserId() {
      return this._activeUserId;
    },

    setMode(mode, userId = null) {
      if (mode !== 'local' && mode !== 'cloud') {
        throw new Error(`Invalid repository mode: "${mode}". Supported: "local", "cloud".`);
      }
      const prevMode = this._mode;
      this._mode = mode;
      this._activeUserId = mode === 'cloud' ? (userId || this._activeUserId) : null;

      if (prevMode !== mode) {
        this._notifyModeChange(mode, this._activeUserId);
      }
    },

    onModeChange(callback) {
      if (typeof callback === 'function') {
        this._listeners.add(callback);
      }
      return () => this._listeners.delete(callback);
    },

    _notifyModeChange(mode, userId) {
      for (const listener of this._listeners) {
        try {
          listener(mode, userId);
        } catch (e) {
          console.error('StudyFlow RepositoryFactory listener error:', e);
        }
      }
    },

    setSupabaseClient(client) {
      this._supabaseClient = client;
      if (this._instances && this._instances.cloud) {
        this._instances.cloud._client = client;
      }
    },

    getRepository(type = null, options = {}) {
      const targetType = type || this._mode;

      if (targetType === 'local') {
        if (!this._instances.local) {
          this._instances.local = new LocalRepository(options.store);
        }
        return this._instances.local;
      }

      if (targetType === 'cloud') {
        const client = options.supabaseClient || this._supabaseClient;
        if (!this._instances.cloud) {
          this._instances.cloud = new CloudRepository(client);
        } else if (client) {
          this._instances.cloud._client = client;
        }
        return this._instances.cloud;
      }

      throw new Error(`Unknown repository type: "${targetType}". Supported types: "local", "cloud".`);
    },

    getActive() {
      return this.getRepository(this._mode);
    },

    /**
     * Async initialization: inspects auth session & migration state
     */
    async init(options = {}) {
      const auth = options.auth || (typeof window !== 'undefined' ? window.Auth : null);
      const migration = options.migration || (typeof window !== 'undefined' ? window.StudyFlowMigration : null);

      if (!auth || typeof auth.getUser !== 'function') {
        this.setMode('local');
        return this.getActive();
      }

      const user = auth.getUser();
      if (!user || !user.id) {
        this.setMode('local');
        return this.getActive();
      }

      // Check migration status
      if (migration && typeof migration.isCompleted === 'function' && migration.isCompleted(user.id)) {
        this.setMode('cloud', user.id);
        const cloudRepo = this.getRepository('cloud');
        // Pre-hydrate cache in background
        cloudRepo.hydrateCache(user.id).catch(() => {});
      } else {
        this.setMode('local');
      }

      return this.getActive();
    },

    reset() {
      this._instances = {};
      this._mode = 'local';
      this._activeUserId = null;
      this._listeners.clear();
    }
  };

  return {
    BaseRepository,
    LocalRepository,
    CloudRepository,
    RepositoryFactory
  };
});
