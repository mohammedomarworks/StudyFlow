/* ==========================================================================
   repository.js — Repository Abstraction Boundary (StudyFlow v2.0 Foundation)
   --------------------------------------------------------------------------
   Defines the contract and architectural boundary for future multi-tier storage:

     UI Layer
        ↓
     Store API (v1.5.0)
        ↓
     Repository Abstraction
        ├── LocalRepository (wraps Store / localStorage)
        └── CloudRepository (stub for Phase C — Supabase PostgreSQL)

   IMPORTANT NOTICE:
   In Phase A, this file establishes the ARCHITECTURAL BOUNDARY ONLY.
   Existing pages and Store logic continue to run 100% locally via localStorage.
   No existing page is migrated or changed in this phase.
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
   * CloudRepository — Future Supabase PostgreSQL implementation (Phase C stub)
   */
  class CloudRepository extends BaseRepository {
    constructor(supabaseClient) {
      super();
      this._client = supabaseClient;
    }

    _notImplemented(methodName) {
      return Promise.reject(
        new Error(`CloudRepository.${methodName} will be implemented in Phase C (Cloud CRUD). Running in local mode.`)
      );
    }

    async getSubjects() { return this._notImplemented('getSubjects'); }
    async getSubject(id) { return this._notImplemented('getSubject'); }
    async saveSubject(data) { return this._notImplemented('saveSubject'); }
    async deleteSubject(id) { return this._notImplemented('deleteSubject'); }

    async getTasks() { return this._notImplemented('getTasks'); }
    async getTask(id) { return this._notImplemented('getTask'); }
    async saveTask(data) { return this._notImplemented('saveTask'); }
    async deleteTask(id) { return this._notImplemented('deleteTask'); }
    async toggleTask(id) { return this._notImplemented('toggleTask'); }

    async getNotes() { return this._notImplemented('getNotes'); }
    async getNote(id) { return this._notImplemented('getNote'); }
    async saveNote(data) { return this._notImplemented('saveNote'); }
    async deleteNote(id) { return this._notImplemented('deleteNote'); }
    async togglePinNote(id) { return this._notImplemented('togglePinNote'); }

    async getHabits(includeArchived) { return this._notImplemented('getHabits'); }
    async getHabit(id) { return this._notImplemented('getHabit'); }
    async saveHabit(data) { return this._notImplemented('saveHabit'); }
    async archiveHabit(id) { return this._notImplemented('archiveHabit'); }
    async restoreHabit(id) { return this._notImplemented('restoreHabit'); }
    async deleteHabit(id) { return this._notImplemented('deleteHabit'); }

    async getHabitCompletions(habitId) { return this._notImplemented('getHabitCompletions'); }
    async toggleHabitCompletion(habitId, dateISO) { return this._notImplemented('toggleHabitCompletion'); }
    async setHabitCompletion(habitId, dateISO, completed) { return this._notImplemented('setHabitCompletion'); }

    async getSessions() { return this._notImplemented('getSessions'); }
    async saveSession(data) { return this._notImplemented('saveSession'); }
    async deleteSession(id) { return this._notImplemented('deleteSession'); }

    async getActivity(limit) { return this._notImplemented('getActivity'); }
    async logActivity(type, title, meta) { return this._notImplemented('logActivity'); }

    async getSettings() { return this._notImplemented('getSettings'); }
    async saveSettings(settings) { return this._notImplemented('saveSettings'); }
  }

  /**
   * RepositoryFactory — Returns appropriate repository instance
   */
  const RepositoryFactory = {
    _instances: {},

    getRepository(type = 'local', options = {}) {
      if (type === 'local') {
        if (!this._instances.local) {
          this._instances.local = new LocalRepository(options.store);
        }
        return this._instances.local;
      }

      if (type === 'cloud') {
        if (!this._instances.cloud) {
          this._instances.cloud = new CloudRepository(options.supabaseClient);
        }
        return this._instances.cloud;
      }

      throw new Error(`Unknown repository type: "${type}". Supported types: "local", "cloud".`);
    },

    reset() {
      this._instances = {};
    }
  };

  return {
    BaseRepository,
    LocalRepository,
    CloudRepository,
    RepositoryFactory
  };
});
