/* ==========================================================================
   migration.js — Local Data Migration Service (StudyFlow v2.0 Phase C)
   --------------------------------------------------------------------------
   Safely transfers local planner data from browser localStorage to Supabase
   PostgreSQL for authenticated users:
   - Referential integrity preservation (Local string IDs -> PostgreSQL UUIDs)
   - Dependency-safe ordering:
       1. subjects
       2. tasks (references subjects.id)
       3. notes (references subjects.id)
       4. habits (references subjects.id)
       5. habit completions (references habits.id)
       6. study sessions (references subjects.id and tasks.id)
       7. settings (upsert on user_id)
   - Idempotency & retry safety (persistent ID map prevents duplicate cloud rows)
   - Zero local data loss (sp_* records are never deleted or modified)
   - Explicit user action only (never runs silently on login)
   ========================================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.StudyFlowMigration = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /**
   * RFC4122 v4 UUID generator with standard fallbacks
   */
  function generateUUID() {
    if (typeof crypto !== 'undefined') {
      if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      if (typeof crypto.getRandomValues === 'function') {
        return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, function (c) {
          return (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16);
        });
      }
    }
    // Math.random fallback for test/legacy environments
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Migration Service Singleton
   */
  const Migration = {
    KEYS: {
      mapPrefix: 'sp_migration_map_',
      statePrefix: 'sp_migration_state_'
    },

    /**
     * Resolve localStorage safely across browser and test contexts
     */
    _getStorage() {
      if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
      if (typeof localStorage !== 'undefined') return localStorage;
      if (typeof global !== 'undefined' && global.localStorage) return global.localStorage;
      if (typeof globalThis !== 'undefined' && globalThis.localStorage) return globalThis.localStorage;
      return null;
    },

    /**
     * Helper to safely read from localStorage
     */
    _storageGet(key, fallback = null) {
      try {
        const storage = this._getStorage();
        if (!storage) return fallback;
        const val = storage.getItem(key);
        return val ? JSON.parse(val) : fallback;
      } catch (e) {
        return fallback;
      }
    },

    /**
     * Helper to safely write to localStorage
     */
    _storageSet(key, val) {
      try {
        const storage = this._getStorage();
        if (!storage) return;
        storage.setItem(key, JSON.stringify(val));
      } catch (e) {
        console.error('StudyFlow Migration localStorage write error:', e);
      }
    },

    /**
     * Resolve the active Store instance
     */
    _getStore(customStore) {
      if (customStore) return customStore;
      if (typeof window !== 'undefined' && window.Store) return window.Store;
      if (typeof global !== 'undefined' && global.Store) return global.Store;
      throw new Error('Local Store is not available in current environment.');
    },

    /**
     * Read raw local entities directly from local localStorage keys,
     * ensuring that local data is preserved and not shadowed by cloud cache.
     */
    _getLocalEntities(storeInstance) {
      const storage = this._getStorage();
      const readKey = (k, fallback) => {
        try {
          if (!storage) return fallback;
          const raw = storage.getItem(k);
          return raw ? JSON.parse(raw) : fallback;
        } catch {
          return fallback;
        }
      };

      const keys = (storeInstance && storeInstance.KEYS) ? storeInstance.KEYS : {
        subjects: 'sp_subjects',
        tasks: 'sp_tasks',
        habits: 'sp_habits',
        habitCompletions: 'sp_habit_completions',
        notes: 'sp_notes',
        sessions: 'sp_sessions',
        settings: 'sp_settings'
      };

      return {
        subjects: readKey(keys.subjects, []),
        tasks: readKey(keys.tasks, []),
        habits: readKey(keys.habits, []),
        habitCompletions: readKey(keys.habitCompletions, []),
        notes: readKey(keys.notes, []),
        sessions: readKey(keys.sessions, []),
        settings: readKey(keys.settings, (storeInstance && typeof storeInstance.getSettings === 'function') ? storeInstance.getSettings() : { theme: 'system' })
      };
    },

    /**
     * Resolve the Supabase client
     */
    _getClient(customClient) {
      if (customClient) return customClient;
      if (typeof window !== 'undefined' && window.StudyFlowSupabase) {
        return window.StudyFlowSupabase.getClient();
      }
      if (typeof global !== 'undefined' && global.StudyFlowSupabase) {
        return global.StudyFlowSupabase.getClient();
      }
      return null;
    },

    /**
     * Resolve current authenticated user
     */
    async _getUser(customUser, client) {
      if (customUser) return customUser;
      if (typeof window !== 'undefined' && window.Auth && typeof window.Auth.getUser === 'function') {
        const u = window.Auth.getUser();
        if (u) return u;
      }
      if (client && client.auth && typeof client.auth.getUser === 'function') {
        const { data, error } = await client.auth.getUser();
        if (!error && data && data.user) return data.user;
      }
      return null;
    },

    /**
     * Read entity counts from local store
     */
    getLocalSummary(storeInstance) {
      const local = this._getLocalEntities(storeInstance);
      const counts = {
        subjects: Array.isArray(local.subjects) ? local.subjects.length : 0,
        tasks: Array.isArray(local.tasks) ? local.tasks.length : 0,
        notes: Array.isArray(local.notes) ? local.notes.length : 0,
        habits: Array.isArray(local.habits) ? local.habits.length : 0,
        habitCompletions: Array.isArray(local.habitCompletions) ? local.habitCompletions.length : 0,
        sessions: Array.isArray(local.sessions) ? local.sessions.length : 0,
        hasSettings: Boolean(local.settings)
      };

      const totalItems = counts.subjects + counts.tasks + counts.notes +
        counts.habits + counts.habitCompletions + counts.sessions;

      return { counts, totalItems };
    },

    /**
     * Generate preview details for UI modal before migrating
     */
    async preview(options = {}) {
      const store = this._getStore(options.store);
      const client = this._getClient(options.supabaseClient);
      const user = await this._getUser(options.user, client);
      const summary = this.getLocalSummary(store);

      let isMigrated = false;
      let previousMigration = null;

      if (user && user.id) {
        previousMigration = this.getStatus(user.id);
        isMigrated = Boolean(previousMigration && previousMigration.migrated);
      }

      return {
        isAuthenticated: Boolean(user),
        user: user ? {
          id: user.id,
          email: user.email,
          displayName: (user.user_metadata && (user.user_metadata.display_name || user.user_metadata.full_name)) ||
            (user.displayName) || 'Student'
        } : null,
        counts: summary.counts,
        totalItems: summary.totalItems,
        isMigrated,
        previousMigration,
        guarantees: [
          'Your local browser data is preserved as an untouched backup.',
          'PostgreSQL Row Level Security ensures only your authenticated account can access migrated data.',
          'All relationships between subjects, tasks, habits, and notes are preserved.',
          'You can return to local backup mode at any time.'
        ]
      };
    },

    /**
     * Get persisted migration status for a specific user ID
     */
    getStatus(userId) {
      if (!userId) return { migrated: false, migratedAt: null, counts: null };
      const state = this._storageGet(this.KEYS.statePrefix + userId, null);
      if (state && state.migrated) {
        return state;
      }
      return { migrated: false, migratedAt: null, counts: null };
    },

    /**
     * Check if migration is complete for a user ID
     */
    isCompleted(userId) {
      const status = this.getStatus(userId);
      return Boolean(status && status.migrated);
    },

    /**
     * Retrieve or initialize persistent ID map for user
     */
    _getIdMap(userId) {
      const emptyMap = { subjects: {}, tasks: {}, habits: {}, notes: {}, sessions: {} };
      if (!userId) return emptyMap;
      const key = this.KEYS.mapPrefix + userId;
      const existing = this._storageGet(key, null);
      if (existing && typeof existing === 'object') {
        return {
          subjects: existing.subjects || {},
          tasks: existing.tasks || {},
          habits: existing.habits || {},
          notes: existing.notes || {},
          sessions: existing.sessions || {}
        };
      }
      return emptyMap;
    },

    /**
     * Save ID map for user
     */
    _saveIdMap(userId, map) {
      if (!userId) return;
      this._storageSet(this.KEYS.mapPrefix + userId, map);
    },

    /**
     * Execute full, dependency-safe data migration to Supabase
     */
    async migrate(options = {}) {
      const store = this._getStore(options.store);
      const client = this._getClient(options.supabaseClient);
      if (!client) {
        throw new Error('Supabase client is not configured or reachable.');
      }

      const user = await this._getUser(options.user, client);
      if (!user || !user.id) {
        throw new Error('You must be signed in to an authenticated account to migrate data.');
      }

      const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
      const idMap = this._getIdMap(user.id);
      const totalSteps = 7;
      let currentStep = 0;

      const report = (step, entity, message, percent) => {
        currentStep = step;
        onProgress({
          step: currentStep,
          totalSteps,
          entity,
          message,
          percent: Math.min(100, Math.max(0, percent))
        });
      };

      try {
        const localData = this._getLocalEntities(store);

        // ====================================================================
        // STEP 1: SUBJECTS
        // ====================================================================
        report(1, 'subjects', 'Migrating subjects...', 14);
        const localSubjects = localData.subjects;
        const subjectsToInsert = [];

        for (const s of localSubjects) {
          if (!s || !s.id) continue;
          if (idMap.subjects[s.id]) continue; // Already migrated

          const cloudId = generateUUID();
          idMap.subjects[s.id] = cloudId;

          subjectsToInsert.push({
            id: cloudId,
            user_id: user.id,
            name: s.name || 'Untitled Subject',
            teacher: s.teacher || null,
            code: s.code || null,
            color: s.color || '#7c3aed',
            exam_date: (typeof s.examDate === 'string' && s.examDate.trim()) ? s.examDate.trim() : null,
            created_at: s.createdAt || new Date().toISOString()
          });
        }

        if (subjectsToInsert.length > 0) {
          const { error: subjErr } = await client.from('subjects').insert(subjectsToInsert);
          if (subjErr) throw new Error(`Subjects migration failed: ${subjErr.message}`);
          this._saveIdMap(user.id, idMap);
        }

        // ====================================================================
        // STEP 2: TASKS
        // ====================================================================
        report(2, 'tasks', 'Migrating tasks and linking subjects...', 28);
        const localTasks = localData.tasks;
        const tasksToInsert = [];

        for (const t of localTasks) {
          if (!t || !t.id) continue;
          if (idMap.tasks[t.id]) continue; // Already migrated

          const cloudId = generateUUID();
          idMap.tasks[t.id] = cloudId;

          const cloudSubjectId = (t.subjectId && idMap.subjects[t.subjectId])
            ? idMap.subjects[t.subjectId]
            : null;

          tasksToInsert.push({
            id: cloudId,
            user_id: user.id,
            subject_id: cloudSubjectId,
            title: t.title || 'Untitled Task',
            notes: t.notes || null,
            category: t.category || 'General',
            priority: ['high', 'medium', 'low'].includes(t.priority) ? t.priority : 'medium',
            due_date: (typeof t.dueDate === 'string' && t.dueDate.trim()) ? t.dueDate.trim() : null,
            estimate_minutes: Number(t.estimate) || 0,
            completed: Boolean(t.completed),
            completed_at: t.completed ? (t.completedAt || new Date().toISOString()) : null,
            created_at: t.createdAt || new Date().toISOString()
          });
        }

        if (tasksToInsert.length > 0) {
          const { error: taskErr } = await client.from('tasks').insert(tasksToInsert);
          if (taskErr) throw new Error(`Tasks migration failed: ${taskErr.message}`);
          this._saveIdMap(user.id, idMap);
        }

        // ====================================================================
        // STEP 3: NOTES
        // ====================================================================
        report(3, 'notes', 'Migrating notes and tags...', 42);
        const localNotes = localData.notes;
        const notesToInsert = [];

        for (const n of localNotes) {
          if (!n || !n.id) continue;
          if (idMap.notes[n.id]) continue; // Already migrated

          const cloudId = generateUUID();
          idMap.notes[n.id] = cloudId;

          const cloudSubjectId = (n.subjectId && idMap.subjects[n.subjectId])
            ? idMap.subjects[n.subjectId]
            : null;

          notesToInsert.push({
            id: cloudId,
            user_id: user.id,
            subject_id: cloudSubjectId,
            title: n.title || 'Untitled Note',
            content: n.content || '',
            tags: Array.isArray(n.tags) ? n.tags.filter(tag => typeof tag === 'string') : [],
            pinned: Boolean(n.pinned),
            created_at: n.createdAt || new Date().toISOString(),
            updated_at: n.updatedAt || n.createdAt || new Date().toISOString()
          });
        }

        if (notesToInsert.length > 0) {
          const { error: noteErr } = await client.from('notes').insert(notesToInsert);
          if (noteErr) throw new Error(`Notes migration failed: ${noteErr.message}`);
          this._saveIdMap(user.id, idMap);
        }

        // ====================================================================
        // STEP 4: HABITS
        // ====================================================================
        report(4, 'habits', 'Migrating habits and schedules...', 56);
        const localHabits = localData.habits;
        const habitsToInsert = [];

        for (const h of localHabits) {
          if (!h || !h.id) continue;
          if (idMap.habits[h.id]) continue; // Already migrated

          const cloudId = generateUUID();
          idMap.habits[h.id] = cloudId;

          const cloudSubjectId = (h.subjectId && idMap.subjects[h.subjectId])
            ? idMap.subjects[h.subjectId]
            : null;

          const targetDays = Array.isArray(h.targetDays)
            ? h.targetDays.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
            : [0, 1, 2, 3, 4, 5, 6];

          habitsToInsert.push({
            id: cloudId,
            user_id: user.id,
            subject_id: cloudSubjectId,
            name: h.name || 'Untitled Habit',
            description: h.description || null,
            icon: h.icon || '⚡',
            color: h.color || '#7c3aed',
            frequency: h.frequency === 'weekdays' ? 'weekdays' : 'daily',
            target_days: targetDays,
            archived: Boolean(h.archived),
            created_at: h.createdAt || new Date().toISOString()
          });
        }

        if (habitsToInsert.length > 0) {
          const { error: habitErr } = await client.from('habits').insert(habitsToInsert);
          if (habitErr) throw new Error(`Habits migration failed: ${habitErr.message}`);
          this._saveIdMap(user.id, idMap);
        }

        // ====================================================================
        // STEP 5: HABIT COMPLETIONS
        // ====================================================================
        report(5, 'habit_completions', 'Migrating habit completion streaks...', 70);
        const localCompletions = localData.habitCompletions;
        const completionsToInsert = [];
        const seenCompletionKeys = new Set();

        for (const c of localCompletions) {
          if (!c || !c.habitId || !c.date) continue;
          const cloudHabitId = idMap.habits[c.habitId];
          if (!cloudHabitId) continue; // Skip orphaned completion

          const dedupKey = `${cloudHabitId}_${c.date}`;
          if (seenCompletionKeys.has(dedupKey)) continue;
          seenCompletionKeys.add(dedupKey);

          completionsToInsert.push({
            user_id: user.id,
            habit_id: cloudHabitId,
            date: c.date,
            completed_at: c.completedAt || new Date().toISOString()
          });
        }

        if (completionsToInsert.length > 0) {
          for (let i = 0; i < completionsToInsert.length; i += 100) {
            const batch = completionsToInsert.slice(i, i + 100);
            const { error: compErr } = await client
              .from('habit_completions')
              .upsert(batch, { onConflict: 'habit_id, date' });
            if (compErr) throw new Error(`Habit completions migration failed: ${compErr.message}`);
          }
        }

        // ====================================================================
        // STEP 6: STUDY SESSIONS
        // ====================================================================
        report(6, 'study_sessions', 'Migrating focus timer sessions...', 84);
        const localSessions = localData.sessions;
        const sessionsToInsert = [];

        for (const s of localSessions) {
          if (!s || !s.id) continue;
          if (idMap.sessions[s.id]) continue; // Already migrated

          const cloudId = generateUUID();
          idMap.sessions[s.id] = cloudId;

          const cloudSubjectId = (s.subjectId && idMap.subjects[s.subjectId])
            ? idMap.subjects[s.subjectId]
            : null;

          const cloudTaskId = (s.taskId && idMap.tasks[s.taskId])
            ? idMap.tasks[s.taskId]
            : null;

          sessionsToInsert.push({
            id: cloudId,
            user_id: user.id,
            subject_id: cloudSubjectId,
            task_id: cloudTaskId,
            type: s.type === 'break' ? 'break' : 'focus',
            duration_minutes: Math.max(1, Number(s.durationMinutes) || 25),
            notes: s.notes || null,
            completed_at: s.completedAt || new Date().toISOString(),
            created_at: s.completedAt || new Date().toISOString()
          });
        }

        if (sessionsToInsert.length > 0) {
          const { error: sessErr } = await client.from('study_sessions').insert(sessionsToInsert);
          if (sessErr) throw new Error(`Study sessions migration failed: ${sessErr.message}`);
          this._saveIdMap(user.id, idMap);
        }

        // ====================================================================
        // STEP 7: SETTINGS
        // ====================================================================
        report(7, 'settings', 'Saving cloud preferences...', 95);
        const localSettings = localData.settings || {};
        const settingsPayload = {
          user_id: user.id,
          theme: localSettings.theme || 'system',
          pomodoro: localSettings.pomodoro || {},
          preferences: localSettings.preferences || {},
          last_export_at: localSettings.lastExportAt || null
        };

        const { error: settErr } = await client
          .from('settings')
          .upsert(settingsPayload, { onConflict: 'user_id' });
        if (settErr) throw new Error(`Settings migration failed: ${settErr.message}`);

        // Finalize state
        const completionState = {
          migrated: true,
          migratedAt: new Date().toISOString(),
          userId: user.id,
          counts: {
            subjects: localSubjects.length,
            tasks: localTasks.length,
            notes: localNotes.length,
            habits: localHabits.length,
            habitCompletions: localCompletions.length,
            sessions: localSessions.length,
            hasSettings: true
          },
          version: '2.0.0'
        };

        this._storageSet(this.KEYS.statePrefix + user.id, completionState);
        this._saveIdMap(user.id, idMap);

        // Switch active repository mode to Cloud if RepositoryFactory is available
        const repoModule = typeof window !== 'undefined'
          ? window.StudyFlowRepository
          : (typeof global !== 'undefined' ? global.StudyFlowRepository : null);

        if (repoModule && repoModule.RepositoryFactory) {
          if (typeof repoModule.RepositoryFactory.setSupabaseClient === 'function') {
            repoModule.RepositoryFactory.setSupabaseClient(client);
          }
          repoModule.RepositoryFactory.setMode('cloud', user.id);
          const cloudRepo = repoModule.RepositoryFactory.getRepository('cloud', { supabaseClient: client });
          if (cloudRepo && typeof cloudRepo.hydrateCache === 'function') {
            try {
              await cloudRepo.hydrateCache(user.id);
            } catch (hErr) {
              console.warn('StudyFlow post-migration cache hydration notice:', hErr);
            }
          }
        }

        report(7, 'complete', 'Migration complete!', 100);

        return {
          success: true,
          migratedAt: completionState.migratedAt,
          counts: completionState.counts
        };

      } catch (err) {
        console.error('StudyFlow Migration failed at step ' + currentStep + ':', err);
        this._saveIdMap(user.id, idMap);
        throw err;
      }
    },

    /**
     * Diagnostic helper: reset migration state for a user
     */
    reset(userId) {
      if (!userId) return;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(this.KEYS.statePrefix + userId);
          localStorage.removeItem(this.KEYS.mapPrefix + userId);
        }
        const repoModule = typeof window !== 'undefined'
          ? window.StudyFlowRepository
          : (typeof global !== 'undefined' ? global.StudyFlowRepository : null);
        if (repoModule && repoModule.RepositoryFactory) {
          repoModule.RepositoryFactory.setMode('local');
        }
      } catch (e) {
        console.warn('StudyFlow Migration reset error:', e);
      }
    }
  };

  return Migration;
});
