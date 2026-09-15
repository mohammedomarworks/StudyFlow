/* ==========================================================================
   realtime.js — Realtime Synchronization Manager (StudyFlow v2.0 Phase D)
   --------------------------------------------------------------------------
   Provides safe Supabase Realtime synchronization for authenticated users:
   - Single channel subscription per authenticated user in Cloud Mode
   - Realtime Postgres changes on subjects, tasks, notes, habits, completions,
     sessions, and settings
   - Cache synchronization directly on sp_cloud_*_${userId} (never touches sp_*)
   - Feedback-loop prevention (remote events never call outbound cloud write APIs)
   - Deterministic Last-Writer-Wins conflict policy with server timestamps
   - Stale-event rejection to protect newer local/cached state
   - Active form safety (detects editing items to prevent silent form resets)
   - Decoupled event emission via callbacks and custom DOM events
   ========================================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.StudyFlowRealtime = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Realtime Status States
  const STATUS = {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    RECONNECTING: 'reconnecting',
    ERROR: 'error',
    PAUSED: 'paused'
  };

  // Supported table to cache key mappings
  const TABLE_KEY_MAP = {
    subjects: 'sp_subjects',
    tasks: 'sp_tasks',
    notes: 'sp_notes',
    habits: 'sp_habits',
    habit_completions: 'sp_habit_completions',
    study_sessions: 'sp_sessions',
    settings: 'sp_settings'
  };

  // Internal module state
  let _status = STATUS.DISCONNECTED;
  let _activeUser = null;
  let _activeClient = null;
  let _activeChannel = null;
  let _lastSynced = null;
  let _lastError = null;
  let _changeListeners = new Set();
  let _statusListeners = new Set();
  let _isPaused = false;
  let _subscribingPromise = null;

  /* ==========================================================================
     Entity Mappers (PostgreSQL snake_case <-> JS camelCase)
     ========================================================================== */

  function fromDbSubject(row) {
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

  function fromDbTask(row) {
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

  function fromDbNote(row) {
    if (!row) return null;
    return {
      id: row.id,
      title: row.title || 'Untitled Note',
      content: typeof row.content === 'string' ? row.content : '',
      tags: Array.isArray(row.tags) ? row.tags : [],
      pinned: Boolean(row.pinned),
      subjectId: row.subject_id || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at || row.created_at
    };
  }

  function fromDbHabit(row) {
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

  function fromDbCompletion(row) {
    if (!row) return null;
    return {
      id: row.id,
      habitId: row.habit_id,
      date: row.date,
      completedAt: row.completed_at
    };
  }

  function fromDbSession(row) {
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

  function fromDbSettings(row) {
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

  function mapDbRecord(table, row) {
    if (!row) return null;
    switch (table) {
      case 'subjects': return fromDbSubject(row);
      case 'tasks': return fromDbTask(row);
      case 'notes': return fromDbNote(row);
      case 'habits': return fromDbHabit(row);
      case 'habit_completions': return fromDbCompletion(row);
      case 'study_sessions': return fromDbSession(row);
      case 'settings': return fromDbSettings(row);
      default: return row;
    }
  }

  /* ==========================================================================
     Storage & Timestamp Helpers
     ========================================================================== */

  function getStorage() {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    if (typeof localStorage !== 'undefined') return localStorage;
    if (typeof global !== 'undefined' && global.localStorage) return global.localStorage;
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) return globalThis.localStorage;
    return null;
  }

  function readCloudCache(baseKey, userId, fallback = []) {
    const storage = getStorage();
    if (!storage || !userId) return fallback;
    try {
      const raw = storage.getItem(`sp_cloud_${baseKey}_${userId}`);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeCloudCache(baseKey, userId, data) {
    const storage = getStorage();
    if (!storage || !userId) return;
    try {
      storage.setItem(`sp_cloud_${baseKey}_${userId}`, JSON.stringify(data));
    } catch (e) {
      console.error('StudyFlow Realtime cache write error:', e);
    }
  }

  /**
   * Parses an ISO or SQL timestamp into milliseconds since epoch.
   * Returns null if unparseable.
   */
  function parseTimestamp(val) {
    if (!val) return null;
    const d = new Date(val);
    const time = d.getTime();
    return Number.isNaN(time) ? null : time;
  }

  /**
   * Extract most recent timestamp from a DB row or mapped JS entity.
   */
  function getEntityTimestamp(entity) {
    if (!entity) return 0;
    const ts = entity.updated_at || entity.updatedAt ||
               entity.completed_at || entity.completedAt ||
               entity.created_at || entity.createdAt ||
               entity.timestamp;
    return parseTimestamp(ts) || 0;
  }

  /* ==========================================================================
     Conflict Resolution & Cache Synchronization
     ========================================================================== */

  /**
   * Applies an incoming remote event directly to the cloud cache.
   * Deterministic Last-Writer-Wins (LWW) conflict policy:
   * - Newer incoming cloud data overwrites older cached state.
   * - Stale incoming events (incoming < cached) are rejected.
   * - DELETE removes matching record from cache.
   * - Never triggers outbound cloud writes.
   * - Never touches local sp_* keys.
   */
  function applyRemoteEvent(table, eventType, newRow, oldRow, userId) {
    if (!table || !eventType || !userId) return { applied: false, reason: 'missing_params' };
    const baseKey = TABLE_KEY_MAP[table];
    if (!baseKey) return { applied: false, reason: 'unsupported_table' };

    // Validate ownership
    if (newRow && newRow.user_id && newRow.user_id !== userId) {
      return { applied: false, reason: 'cross_user_isolation' };
    }
    if (oldRow && oldRow.user_id && oldRow.user_id !== userId) {
      return { applied: false, reason: 'cross_user_isolation' };
    }

    const normEvent = eventType.toUpperCase();

    // ------------------------------------------------------------------------
    // SINGLETON TABLE: SETTINGS
    // ------------------------------------------------------------------------
    if (table === 'settings') {
      const current = readCloudCache('sp_settings', userId, null);
      if (normEvent === 'DELETE') {
        writeCloudCache('sp_settings', userId, fromDbSettings(null));
        return { applied: true, eventType: 'DELETE', record: null };
      }

      const incoming = fromDbSettings(newRow);
      if (current) {
        const incomingTime = getEntityTimestamp(newRow);
        const currentTime = getEntityTimestamp(current);
        if (incomingTime > 0 && currentTime > 0 && incomingTime < currentTime) {
          return { applied: false, reason: 'stale_event', incomingTime, currentTime };
        }
      }

      writeCloudCache('sp_settings', userId, incoming);
      return { applied: true, eventType: normEvent, record: incoming };
    }

    // ------------------------------------------------------------------------
    // LIST TABLES: subjects, tasks, notes, habits, completions, sessions
    // ------------------------------------------------------------------------
    const list = readCloudCache(baseKey, userId, []);
    const items = Array.isArray(list) ? [...list] : [];

    // Helper: find index of matching record in cache
    function findItemIndex(recordId, habitId = null, dateStr = null) {
      if (table === 'habit_completions' && habitId && dateStr) {
        const idx = items.findIndex(item => item.habitId === habitId && item.date === dateStr);
        if (idx !== -1) return idx;
      }
      if (recordId) {
        return items.findIndex(item => item.id === recordId);
      }
      return -1;
    }

    if (normEvent === 'DELETE') {
      const targetId = (oldRow && oldRow.id) || (newRow && newRow.id);
      const habitId = (oldRow && oldRow.habit_id) || (newRow && newRow.habit_id);
      const dateStr = (oldRow && oldRow.date) || (newRow && newRow.date);

      const idx = findItemIndex(targetId, habitId, dateStr);
      if (idx !== -1) {
        const removed = items.splice(idx, 1)[0];
        writeCloudCache(baseKey, userId, items);
        return { applied: true, eventType: 'DELETE', record: removed };
      }
      return { applied: false, reason: 'not_found' };
    }

    if (normEvent === 'INSERT' || normEvent === 'UPDATE') {
      const mapped = mapDbRecord(table, newRow);
      if (!mapped) return { applied: false, reason: 'mapping_failed' };

      const targetId = mapped.id;
      const habitId = mapped.habitId;
      const dateStr = mapped.date;

      const idx = findItemIndex(targetId, habitId, dateStr);

      if (idx !== -1) {
        // Record already exists in cache — check for stale event
        const existing = items[idx];
        const incomingTime = getEntityTimestamp(newRow);
        const existingTime = getEntityTimestamp(existing);

        if (incomingTime > 0 && existingTime > 0 && incomingTime < existingTime) {
          return { applied: false, reason: 'stale_event', incomingTime, existingTime };
        }

        items[idx] = mapped;
        writeCloudCache(baseKey, userId, items);
        return { applied: true, eventType: normEvent, record: mapped, oldRecord: existing };
      } else {
        // Record does not exist in cache — insert it
        items.push(mapped);
        writeCloudCache(baseKey, userId, items);
        return { applied: true, eventType: 'INSERT', record: mapped };
      }
    }

    return { applied: false, reason: 'unsupported_event' };
  }

  /* ==========================================================================
     Active Form Protection Helper
     ========================================================================== */

  /**
   * Checks if user is currently editing the item in an open modal.
   * Returns true if active modal form is dirty for this item.
   */
  function isUserActivelyEditing(table, recordId) {
    if (typeof document === 'undefined' || !recordId) return false;
    try {
      const isModalOpen = (modal) => modal && (modal.classList.contains('open') || modal.classList.contains('active') || modal.style.display === 'block' || modal.style.display === 'flex');

      if (table === 'tasks') {
        const modal = document.querySelector('#taskModal');
        const idInput = document.querySelector('#taskId') || (modal && modal.querySelector('#taskId'));
        if (isModalOpen(modal) && idInput && idInput.value === recordId) {
          return true;
        }
      } else if (table === 'subjects') {
        const modal = document.querySelector('#subjectModal');
        const idInput = document.querySelector('#subjectId') || (modal && modal.querySelector('#subjectId'));
        if (isModalOpen(modal) && idInput && idInput.value === recordId) {
          return true;
        }
      } else if (table === 'notes') {
        const modal = document.querySelector('#noteModal');
        const idInput = document.querySelector('#noteId') || (modal && modal.querySelector('#noteId'));
        if (isModalOpen(modal) && idInput && idInput.value === recordId) {
          return true;
        }
      } else if (table === 'habits') {
        const modal = document.querySelector('#habitModal');
        const idInput = document.querySelector('#habitId') || (modal && modal.querySelector('#habitId'));
        if (isModalOpen(modal) && idInput && idInput.value === recordId) {
          return true;
        }
      }
    } catch (e) {
      // Ignored
    }
    return false;
  }

  /* ==========================================================================
     Realtime Client & Subscription Lifecycle
     ========================================================================== */

  function setStatus(newStatus, error = null) {
    const prevStatus = _status;
    _status = newStatus;
    if (error) _lastError = error;

    if (prevStatus !== newStatus || error) {
      notifyStatusListeners(_status, _lastSynced, _lastError);
    }
  }

  function notifyStatusListeners(status, lastSynced, error) {
    for (const listener of _statusListeners) {
      try {
        listener(status, lastSynced, error);
      } catch (e) {
        console.error('[StudyFlow Realtime] Status listener error:', e);
      }
    }
  }

  function notifyChangeListeners(payload) {
    for (const listener of _changeListeners) {
      try {
        listener(payload);
      } catch (e) {
        console.error('[StudyFlow Realtime] Change listener error:', e);
      }
    }

    // Dispatch DOM CustomEvent for loose coupling
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      try {
        const event = new CustomEvent('studyflow:realtime-change', {
          detail: payload,
          bubbles: true
        });
        window.dispatchEvent(event);
      } catch (e) {
        console.error('[StudyFlow Realtime] DOM event dispatch error:', e);
      }
    }
  }

  function resolveSupabaseClient(customClient) {
    if (customClient) return customClient;
    if (_activeClient) return _activeClient;
    if (typeof window !== 'undefined' && window.StudyFlowSupabase) {
      return window.StudyFlowSupabase.getClient();
    }
    if (typeof global !== 'undefined' && global.StudyFlowSupabase) {
      return global.StudyFlowSupabase.getClient();
    }
    return null;
  }

  function resolveMode() {
    const repo = (typeof window !== 'undefined' && window.StudyFlowRepository) ||
                 (typeof global !== 'undefined' && global.StudyFlowRepository);
    if (repo && repo.RepositoryFactory && typeof repo.RepositoryFactory.getMode === 'function') {
      return repo.RepositoryFactory.getMode();
    }
    return 'local';
  }

  /**
   * Initializes Realtime manager for active user.
   * Idempotent: Calling initialize multiple times with same user ID does not duplicate subscriptions.
   */
  function initialize(user, options = {}) {
    if (!user || !user.id) {
      destroy();
      return null;
    }

    const sameUser = _activeUser && _activeUser.id === user.id;
    _activeUser = {
      id: user.id,
      email: user.email || '',
      displayName: user.displayName || user.display_name || 'Student'
    };

    if (options.supabaseClient) {
      _activeClient = options.supabaseClient;
    }

    // If already subscribed for this user and channel is active, retain it
    if (sameUser && _activeChannel && _status === STATUS.CONNECTED) {
      return _activeChannel;
    }

    return null;
  }

  /**
   * Establishes Supabase Realtime channel subscription.
   * Strictly verifies:
   * 1. User is authenticated.
   * 2. RepositoryFactory mode is 'cloud'.
   * 3. Supabase client is available.
   */
  async function subscribe(options = {}) {
    if (_subscribingPromise) {
      return _subscribingPromise;
    }

    _subscribingPromise = (async () => {
      try {
        const user = _activeUser || options.user;
        if (!user || !user.id) {
          setStatus(STATUS.DISCONNECTED);
          return false;
        }

        const mode = options.mode || resolveMode();
        if (mode !== 'cloud') {
          // Unauthenticated, local-only, or unmigrated mode MUST NOT subscribe
          setStatus(STATUS.DISCONNECTED);
          return false;
        }

        const client = resolveSupabaseClient(options.supabaseClient);
        if (!client || typeof client.channel !== 'function') {
          setStatus(STATUS.DISCONNECTED);
          return false;
        }

        // If already connected with an active channel, do not duplicate
        if (_activeChannel && _status === STATUS.CONNECTED) {
          return true;
        }

        // Clean up any stale channel before creating a new one
        await unsubscribe();

        setStatus(STATUS.CONNECTING);
        const channelName = `studyflow_realtime_${user.id}`;
        const channel = client.channel(channelName);

        const tables = ['subjects', 'tasks', 'notes', 'habits', 'habit_completions', 'study_sessions', 'settings'];

        // Register postgres_changes listeners for each user table
        tables.forEach(tableName => {
          channel.on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: tableName,
              filter: `user_id=eq.${user.id}`
            },
            payload => {
              if (_isPaused) return;

              const eventType = payload.eventType || payload.event;
              const newRow = payload.new || payload.record;
              const oldRow = payload.old || payload.old_record;

              const result = applyRemoteEvent(tableName, eventType, newRow, oldRow, user.id);

              if (result.applied) {
                _lastSynced = new Date().toISOString();
                setStatus(STATUS.CONNECTED);

                const changePayload = {
                  table: tableName,
                  eventType: result.eventType,
                  record: result.record,
                  oldRecord: result.oldRecord || null,
                  timestamp: _lastSynced,
                  isEditing: isUserActivelyEditing(tableName, (result.record && result.record.id) || (oldRow && oldRow.id))
                };

                notifyChangeListeners(changePayload);
              }
            }
          );
        });

        // Subscribe to channel
        await new Promise((resolve, reject) => {
          channel.subscribe((subStatus, err) => {
            if (subStatus === 'SUBSCRIBED') {
              _activeChannel = channel;
              _lastSynced = _lastSynced || new Date().toISOString();
              setStatus(STATUS.CONNECTED);
              resolve(true);
            } else if (subStatus === 'TIMED_OUT') {
              setStatus(STATUS.RECONNECTING, err || new Error('Connection timed out'));
            } else if (subStatus === 'CLOSED') {
              setStatus(STATUS.DISCONNECTED);
            } else if (subStatus === 'CHANNEL_ERROR') {
              setStatus(STATUS.ERROR, err || new Error('Channel subscription failed'));
              reject(err || new Error('Channel subscription error'));
            }
          });
        });

        return true;
      } catch (err) {
        console.warn('[StudyFlow Realtime] Subscription error:', err);
        setStatus(STATUS.ERROR, err);
        return false;
      } finally {
        _subscribingPromise = null;
      }
    })();

    return _subscribingPromise;
  }

  /**
   * Unsubscribes active channel safely without clearing event listeners.
   */
  async function unsubscribe() {
    if (_activeChannel) {
      try {
        const client = resolveSupabaseClient();
        if (client && typeof client.removeChannel === 'function') {
          await client.removeChannel(_activeChannel);
        } else if (typeof _activeChannel.unsubscribe === 'function') {
          await _activeChannel.unsubscribe();
        }
      } catch (e) {
        console.warn('[StudyFlow Realtime] Channel teardown error:', e);
      } finally {
        _activeChannel = null;
      }
    }
    setStatus(STATUS.DISCONNECTED);
    return true;
  }

  /**
   * Destroys active subscription, clears user state and all listeners (on logout/reset).
   */
  async function destroy() {
    await unsubscribe();
    _activeUser = null;
    _activeClient = null;
    _lastSynced = null;
    _lastError = null;
    _isPaused = false;
    _subscribingPromise = null;
    _changeListeners.clear();
    _statusListeners.clear();
    setStatus(STATUS.DISCONNECTED);
  }

  /**
   * Temporarily pauses event processing.
   */
  function pause() {
    _isPaused = true;
    setStatus(STATUS.PAUSED);
  }

  /**
   * Resumes event processing.
   */
  function resume() {
    _isPaused = false;
    if (_activeChannel) {
      setStatus(STATUS.CONNECTED);
    } else if (_activeUser && resolveMode() === 'cloud') {
      subscribe().catch(() => {});
    }
  }

  /**
   * Returns current status string.
   */
  function getStatus() {
    return _status;
  }

  /**
   * Returns ISO timestamp of last synced event.
   */
  function getLastSynced() {
    return _lastSynced;
  }

  /**
   * Returns active user object or null.
   */
  function getUser() {
    return _activeUser;
  }

  /**
   * Registers a listener for data change events.
   * Returns unsubscribe function.
   */
  function onChange(callback) {
    if (typeof callback !== 'function') return () => {};
    _changeListeners.add(callback);
    return () => _changeListeners.delete(callback);
  }

  /**
   * Registers a listener for connection status changes.
   * Immediately calls back with current state.
   * Returns unsubscribe function.
   */
  function onStatusChange(callback) {
    if (typeof callback !== 'function') return () => {};
    _statusListeners.add(callback);
    try {
      callback(_status, _lastSynced, _lastError);
    } catch (e) {
      console.error('[StudyFlow Realtime] Immediate status listener error:', e);
    }
    return () => _statusListeners.delete(callback);
  }

  /**
   * Internal test reset helper.
   */
  function reset() {
    if (_activeChannel) {
      try {
        if (typeof _activeChannel.unsubscribe === 'function') _activeChannel.unsubscribe();
      } catch {}
    }
    _status = STATUS.DISCONNECTED;
    _activeUser = null;
    _activeClient = null;
    _activeChannel = null;
    _lastSynced = null;
    _lastError = null;
    _changeListeners.clear();
    _statusListeners.clear();
    _isPaused = false;
    _subscribingPromise = null;
  }

  return {
    STATUS,
    TABLE_KEY_MAP,
    initialize,
    subscribe,
    unsubscribe,
    destroy,
    pause,
    resume,
    getStatus,
    getLastSynced,
    getUser,
    onChange,
    onStatusChange,
    applyRemoteEvent,
    isUserActivelyEditing,
    mapDbRecord,
    fromDbSubject,
    fromDbTask,
    fromDbNote,
    fromDbHabit,
    fromDbCompletion,
    fromDbSession,
    fromDbSettings,
    reset
  };
});
