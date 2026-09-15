/* ==========================================================================
   sync-queue.js — Offline Resilience & Reliable Cloud Write Queue (Phase E)
   --------------------------------------------------------------------------
   Guarantees zero data loss for authenticated users in Cloud Mode when offline
   or when Supabase connectivity is temporarily degraded:
     1. Durable localStorage queue storage under `sp_sync_queue_${userId}`
     2. Optimistic local cloud cache updates (`sp_cloud_*_${userId}`)
     3. FIFO replay engine with exponential backoff + jitter
     4. In-memory single-worker lock (_isProcessing) to avoid duplicate writes
     5. Queue compaction (coalesces duplicate updates, resolves create+delete)
     6. Error classification (transient retry, permanent isolation, auth pause)
     7. Last-Writer-Wins (LWW) conflict checking with Phase D server timestamps
     8. Clean isolation (never touches v1.5.0 local backup keys `sp_*`)
     9. Feedback loop prevention (realtime events never enqueue writes)
   ========================================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.StudyFlowSyncQueue = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Queue and Sync Lifecycle States
  const STATUS = {
    IDLE: 'idle',
    SYNCING: 'syncing',
    PAUSED: 'paused',
    ERROR: 'error'
  };

  // Error Classification Types
  const ERROR_TYPE = {
    TRANSIENT: 'transient',
    PERMANENT: 'permanent',
    AUTH: 'auth'
  };

  // Backoff intervals in milliseconds
  const BACKOFF_SCHEDULE_MS = [1000, 2000, 5000, 10000, 30000];
  const MAX_ATTEMPTS = 5;

  // Module state
  let _userId = null;
  let _client = null;
  let _repository = null;
  let _status = STATUS.IDLE;
  let _isProcessing = false;
  let _currentProcessPromise = null;
  let _processAgain = false;
  let _retryTimer = null;
  let _lastSyncAt = null;
  let _lastError = null;
  let _isPaused = false;
  let _onlineListener = null;
  let _offlineListener = null;

  const _changeListeners = new Set();
  const _statusListeners = new Set();

  /* ==========================================================================
     Environment & Storage Helpers
     ========================================================================== */

  function getStorage() {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    if (typeof localStorage !== 'undefined') return localStorage;
    if (typeof global !== 'undefined' && global.localStorage) return global.localStorage;
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) return globalThis.localStorage;
    return null;
  }

  function isOnline() {
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      return navigator.onLine;
    }
    return true;
  }

  function getQueueKey(userId) {
    const uid = userId || _userId;
    return uid ? `sp_sync_queue_${uid}` : null;
  }

  function readQueue(userId) {
    const storage = getStorage();
    const key = getQueueKey(userId);
    if (!storage || !key) return [];
    try {
      const raw = storage.getItem(key);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function writeQueue(userId, queue) {
    const storage = getStorage();
    const key = getQueueKey(userId);
    if (!storage || !key) return;
    try {
      storage.setItem(key, JSON.stringify(queue));
      notifyChange(queue);
    } catch (e) {
      console.error('StudyFlow SyncQueue write error:', e);
    }
  }

  function generateId() {
    return 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
  }

  function parseTimestamp(val) {
    if (!val) return null;
    const d = new Date(val);
    const time = d.getTime();
    return Number.isNaN(time) ? null : time;
  }

  /* ==========================================================================
     Error Classification
     ========================================================================== */

  /**
   * Classifies an error into transient, permanent, or auth.
   */
  function classifyError(err) {
    if (!err) return ERROR_TYPE.TRANSIENT;

    // Check offline status
    if (!isOnline()) return ERROR_TYPE.TRANSIENT;

    const message = (err.message || String(err)).toLowerCase();
    const status = err.status || (err.response && err.response.status) || 0;
    const code = err.code || '';

    // Auth expired / invalid session
    if (
      status === 401 ||
      message.includes('jwt') ||
      message.includes('token') ||
      message.includes('not authenticated') ||
      message.includes('session expired') ||
      message.includes('auth')
    ) {
      return ERROR_TYPE.AUTH;
    }

    // Transient network errors
    if (
      message.includes('fetch failed') ||
      message.includes('failed to fetch') ||
      message.includes('network') ||
      message.includes('abort') ||
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      status === 0 ||
      status === 408 ||
      status === 429 ||
      (status >= 500 && status <= 599)
    ) {
      return ERROR_TYPE.TRANSIENT;
    }

    // Permanent errors (RLS violation, schema mismatch, validation error, 404, 422)
    if (
      status === 400 ||
      status === 403 ||
      status === 404 ||
      status === 409 ||
      status === 422 ||
      code === '42501' || // Postgres RLS permission denied
      code === '23505' || // Unique violation
      code === '23503' || // Foreign key violation
      message.includes('violates') ||
      message.includes('row-level security') ||
      message.includes('permission denied') ||
      message.includes('invalid input')
    ) {
      return ERROR_TYPE.PERMANENT;
    }

    return ERROR_TYPE.TRANSIENT;
  }

  function getBackoffDelay(attempts) {
    const idx = Math.min(Math.max(0, attempts - 1), BACKOFF_SCHEDULE_MS.length - 1);
    const base = BACKOFF_SCHEDULE_MS[idx];
    const jitter = Math.floor(Math.random() * (base * 0.25));
    return base + jitter;
  }

  /* ==========================================================================
     Listener & Event Notifications
     ========================================================================== */

  function notifyChange(queue) {
    for (const listener of _changeListeners) {
      try {
        listener(queue);
      } catch (e) {
        console.error('StudyFlow SyncQueue onChange listener error:', e);
      }
    }
    dispatchCustomEvent('studyflow:sync-change', {
      status: _status,
      pendingCount: getPendingCount(queue),
      failedCount: getFailedCount(queue),
      lastSyncAt: _lastSyncAt,
      lastError: _lastError
    });
  }

  function notifyStatus(status, details = {}) {
    _status = status;
    for (const listener of _statusListeners) {
      try {
        listener(status, details);
      } catch (e) {
        console.error('StudyFlow SyncQueue onStatusChange listener error:', e);
      }
    }
    dispatchCustomEvent('studyflow:sync-status', {
      status,
      ...details
    });
  }

  function dispatchCustomEvent(name, detail) {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      try {
        window.dispatchEvent(new CustomEvent(name, { detail }));
      } catch {}
    }
  }

  function getPendingCount(queue) {
    const q = queue || readQueue();
    return q.filter(item => item.status === 'pending' || item.status === 'processing').length;
  }

  function getFailedCount(queue) {
    const q = queue || readQueue();
    return q.filter(item => item.status === 'failed' || item.status === 'permanent_error').length;
  }

  /* ==========================================================================
     Queue Compaction (Coalescing)
     ========================================================================== */

  /**
   * Compacts queue to eliminate redundant mutations:
   * 1. Multiple successive updates to the same record are merged into one.
   * 2. If an item was created offline and then deleted before syncing, both are removed.
   * 3. Multiple setHabitCompletion operations on the same (habitId, date) retain only the latest.
   */
  function compactQueue(queue) {
    const list = queue || readQueue();
    if (!Array.isArray(list) || list.length <= 1) return list;

    const result = [];
    const recordMap = new Map(); // key -> list of queue item indices

    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      // Do not touch items already in permanent_error unless retrying
      if (item.status === 'permanent_error') {
        result.push(item);
        continue;
      }

      const entityKey = item.table + ':' + (item.recordId || '') + (item.secondaryId ? ':' + item.secondaryId : '');

      if (!recordMap.has(entityKey)) {
        recordMap.set(entityKey, [result.length]);
        result.push({ ...item });
      } else {
        const priorIndices = recordMap.get(entityKey);
        const lastIdx = priorIndices[priorIndices.length - 1];
        const lastItem = result[lastIdx];

        // Scenario A: Offline creation followed by deletion -> cancel both if never synced to cloud
        const isCreate = (lastItem.action.startsWith('save') || lastItem.action.startsWith('insert')) &&
                         (!lastItem.recordId || lastItem.recordId.startsWith('task-') || lastItem.recordId.startsWith('sub-') ||
                          lastItem.recordId.startsWith('note-') || lastItem.recordId.startsWith('hbt-') || lastItem.recordId.startsWith('ses-'));
        const isDelete = item.action.startsWith('delete');

        if (isCreate && isDelete) {
          // Remove the created item from result
          result.splice(lastIdx, 1);
          priorIndices.pop();
          // Drop both operations
          continue;
        }

        // Scenario B: Multiple saves / updates to the same record -> coalesce payloads into the latest
        const isSaveAction = item.action.startsWith('save') || item.action.startsWith('update');
        const isLastSaveAction = lastItem.action.startsWith('save') || lastItem.action.startsWith('update');

        if (isSaveAction && isLastSaveAction && lastItem.status === 'pending') {
          // Merge payload: latest values overwrite earlier values, preserve original creation time
          lastItem.payload = { ...lastItem.payload, ...item.payload };
          lastItem.createdAt = item.createdAt; // latest timestamp
          lastItem.action = item.action;
          continue;
        }

        // Scenario C: Habit completion toggles on the same (habitId, date)
        if (item.table === 'habit_completions' && item.secondaryId && lastItem.secondaryId === item.secondaryId) {
          result[lastIdx] = { ...item };
          continue;
        }

        // Default: keep sequential item
        priorIndices.push(result.length);
        result.push({ ...item });
      }
    }

    return result;
  }

  /* ==========================================================================
     Conflict Resolution (Last-Writer-Wins)
     ========================================================================== */

  /**
   * Checks remote state in Supabase before executing an update.
   * If remote record is newer than the queued item's createdAt, remote wins (skip update).
   * If queued item is newer or equal, queued update proceeds.
   */
  async function checkRemoteConflict(client, item) {
    if (!client || !item || !item.recordId || !item.table || item.table === 'settings') {
      return { proceed: true };
    }

    // Only updates can conflict with newer remote records; inserts and deletes proceed
    if (!item.action.startsWith('save') && !item.action.startsWith('update')) {
      return { proceed: true };
    }

    try {
      const { data: remoteRow, error } = await client
        .from(item.table)
        .select('*')
        .eq('id', item.recordId)
        .maybeSingle();

      if (error || !remoteRow) {
        // Record might not exist yet or error occurred; proceed with write
        return { proceed: true };
      }

      const remoteTimestamp = parseTimestamp(remoteRow.updated_at || remoteRow.created_at);
      const queuedTimestamp = parseTimestamp(item.createdAt);

      if (remoteTimestamp && queuedTimestamp && remoteTimestamp > queuedTimestamp) {
        // Remote is newer: reject stale local write to honor Last-Writer-Wins
        return {
          proceed: false,
          reason: 'remote_newer',
          remoteRow
        };
      }

      return { proceed: true };
    } catch {
      return { proceed: true };
    }
  }

  /* ==========================================================================
     Execution Engine
     ========================================================================== */

  /**
   * Executes a single queue item via the Supabase client or CloudRepository.
   */
  async function executeItem(item, client, repository) {
    const repo = repository || (
      typeof window !== 'undefined' && window.StudyFlowRepository
        ? window.StudyFlowRepository.RepositoryFactory.getActive()
        : (typeof global !== 'undefined' && global.StudyFlowRepository
            ? global.StudyFlowRepository.RepositoryFactory.getActive()
            : null)
    );

    // 1. Conflict check for updates
    if (client) {
      const conflictCheck = await checkRemoteConflict(client, item);
      if (!conflictCheck.proceed) {
        console.info(`StudyFlow SyncQueue: Skipped stale item ${item.id} (${item.action}) — remote record is newer.`);
        // Refresh local cloud cache with the newer remote record
        if (conflictCheck.remoteRow && repo && typeof repo.hydrateCache === 'function') {
          repo.hydrateCache(item.userId).catch(() => {});
        }
        return { success: true, skippedDueToConflict: true };
      }
    }

    // 2. Dispatch to repository method with isReplay: true
    if (!repo) {
      throw new Error('Repository is not available for SyncQueue replay.');
    }

    const action = item.action;
    const payload = item.payload;
    const recordId = item.recordId;
    const secondaryId = item.secondaryId;
    const options = { isReplay: true };

    switch (action) {
      // Subjects
      case 'saveSubject':
        return await repo.saveSubject(payload, options);
      case 'deleteSubject':
        return await repo.deleteSubject(recordId, options);

      // Tasks
      case 'saveTask':
        return await repo.saveTask(payload, options);
      case 'deleteTask':
        return await repo.deleteTask(recordId, options);
      case 'toggleTask':
        return await repo.toggleTask(recordId, options);

      // Notes
      case 'saveNote':
        return await repo.saveNote(payload, options);
      case 'deleteNote':
        return await repo.deleteNote(recordId, options);
      case 'togglePinNote':
        return await repo.togglePinNote(recordId, options);

      // Habits
      case 'saveHabit':
        return await repo.saveHabit(payload, options);
      case 'archiveHabit':
        return await repo.archiveHabit(recordId, options);
      case 'restoreHabit':
        return await repo.restoreHabit(recordId, options);
      case 'deleteHabit':
        return await repo.deleteHabit(recordId, options);

      // Habit Completions
      case 'setHabitCompletion':
        return await repo.setHabitCompletion(recordId, secondaryId, payload ? payload.completed : true, options);
      case 'toggleHabitCompletion':
        return await repo.toggleHabitCompletion(recordId, secondaryId, options);

      // Study Sessions
      case 'saveSession':
        return await repo.saveSession(payload, options);
      case 'deleteSession':
        return await repo.deleteSession(recordId, options);

      // Settings
      case 'saveSettings':
        return await repo.saveSettings(payload, options);

      default:
        throw new Error(`Unsupported sync queue action: "${action}"`);
    }
  }

  /* ==========================================================================
     Public API Implementation
     ========================================================================== */

  const StudyFlowSyncQueue = {
    /**
     * Initializes the queue for an authenticated user.
     */
    init(options = {}) {
      _userId = options.userId || _userId;
      _client = options.supabaseClient || _client;
      _repository = options.repository || _repository;

      if (!_userId) {
        this.pause();
        return;
      }

      _isPaused = false;
      this._bindNetworkEvents();

      // If online and pending items exist, trigger processing
      if (isOnline()) {
        const queue = readQueue(_userId);
        if (getPendingCount(queue) > 0) {
          this.process().catch(() => {});
        }
      } else {
        notifyStatus(STATUS.PAUSED, { reason: 'offline' });
      }
    },

    _bindNetworkEvents() {
      if (typeof window === 'undefined') return;

      if (!_onlineListener) {
        _onlineListener = () => {
          console.info('StudyFlow SyncQueue: Network restored (online).');
          _isPaused = false;
          this.process().catch(err => {
            console.warn('StudyFlow SyncQueue online flush notice:', err);
          });
        };
        window.addEventListener('online', _onlineListener);
      }

      if (!_offlineListener) {
        _offlineListener = () => {
          console.info('StudyFlow SyncQueue: Network lost (offline). Queue paused.');
          this.pause();
        };
        window.addEventListener('offline', _offlineListener);
      }
    },

    _unbindNetworkEvents() {
      if (typeof window === 'undefined') return;
      if (_onlineListener) {
        window.removeEventListener('online', _onlineListener);
        _onlineListener = null;
      }
      if (_offlineListener) {
        window.removeEventListener('offline', _offlineListener);
        _offlineListener = null;
      }
    },

    /**
     * Enqueues an action for durable persistence and background sync.
     */
    enqueue(entry = {}) {
      const uid = entry.userId || _userId;
      if (!uid) {
        console.warn('StudyFlow SyncQueue: enqueue called without valid userId.');
        return null;
      }

      const queueItem = {
        id: entry.id || generateId(),
        userId: uid,
        action: entry.action,
        table: entry.table,
        recordId: entry.recordId || null,
        secondaryId: entry.secondaryId || null,
        payload: entry.payload || null,
        createdAt: entry.createdAt || new Date().toISOString(),
        attempts: 0,
        maxAttempts: entry.maxAttempts || MAX_ATTEMPTS,
        status: 'pending',
        lastAttemptAt: null,
        lastError: null,
        errorType: null
      };

      const currentQueue = readQueue(uid);
      currentQueue.push(queueItem);

      // Compact queue to merge redundant updates
      const compacted = compactQueue(currentQueue);
      writeQueue(uid, compacted);

      // Trigger processing if online and not paused
      if (isOnline() && !_isPaused) {
        this.process().catch(() => {});
      }

      return queueItem;
    },

    /**
     * Processes the queue in strict FIFO order using a single-worker concurrency lock.
     */
    process() {
      if (_isPaused || !isOnline()) {
        notifyStatus(STATUS.PAUSED, { reason: !isOnline() ? 'offline' : 'paused' });
        return Promise.resolve({ status: 'paused' });
      }

      const uid = _userId;
      if (!uid) return Promise.resolve({ status: 'no_user' });

      if (_currentProcessPromise) {
        _processAgain = true;
        return _currentProcessPromise;
      }

      _isProcessing = true;
      _currentProcessPromise = (async () => {
        notifyStatus(STATUS.SYNCING);

        if (_retryTimer) {
          clearTimeout(_retryTimer);
          _retryTimer = null;
        }

        try {
          do {
            _processAgain = false;

            while (!_isPaused && isOnline()) {
              const queue = readQueue(uid);
              const itemIndex = queue.findIndex(item => item.status === 'pending' || item.status === 'processing');
              if (itemIndex === -1) {
                break;
              }

              const item = queue[itemIndex];
              item.status = 'processing';
              item.attempts = (item.attempts || 0) + 1;
              item.lastAttemptAt = new Date().toISOString();
              writeQueue(uid, queue);

              try {
                await executeItem(item, _client, _repository);

                // Item succeeded! Remove from queue (FIFO)
                const latestQueue = readQueue(uid);
                const idx = latestQueue.findIndex(q => q.id === item.id);
                if (idx !== -1) {
                  latestQueue.splice(idx, 1);
                  writeQueue(uid, latestQueue);
                }
                _lastSyncAt = new Date().toISOString();
                _lastError = null;
              } catch (err) {
                const latestQueue = readQueue(uid);
                const target = latestQueue.find(q => q.id === item.id) || item;
                const errType = classifyError(err);
                target.lastError = err.message || String(err);
                target.errorType = errType;
                _lastError = target.lastError;

                if (errType === ERROR_TYPE.AUTH) {
                  target.status = 'pending';
                  writeQueue(uid, latestQueue);
                  _isPaused = true;
                  notifyStatus(STATUS.PAUSED, { reason: 'auth_expired' });
                  break;
                } else if (errType === ERROR_TYPE.PERMANENT || target.attempts >= target.maxAttempts) {
                  target.status = 'permanent_error';
                  writeQueue(uid, latestQueue);
                  console.error(`StudyFlow SyncQueue permanent error on item ${target.id} (${target.action}):`, err);
                } else {
                  target.status = 'failed';
                  writeQueue(uid, latestQueue);

                  const delay = getBackoffDelay(target.attempts);
                  console.warn(`StudyFlow SyncQueue transient failure (attempt ${target.attempts}/${target.maxAttempts}). Retrying in ${delay}ms:`, err);

                  _retryTimer = setTimeout(() => {
                    _retryTimer = null;
                    const retryQueue = readQueue(uid);
                    const retryItem = retryQueue.find(q => q.id === target.id);
                    if (retryItem && retryItem.status === 'failed') {
                      retryItem.status = 'pending';
                      writeQueue(uid, retryQueue);
                    }
                    this.process().catch(() => {});
                  }, delay);

                  notifyStatus(STATUS.ERROR, { error: err.message, retryInMs: delay });
                  break; // Stop loop, wait for retry timer
                }
              }
            }

            if (_isPaused || !isOnline()) {
              notifyStatus(STATUS.PAUSED, { reason: !isOnline() ? 'offline' : 'paused' });
              break;
            }
          } while (_processAgain && !_isPaused && isOnline());

          const finalQueue = readQueue(uid);
          const remainingPending = getPendingCount(finalQueue);
          const remainingFailed = getFailedCount(finalQueue);

          if (remainingFailed > 0 && remainingPending === 0) {
            notifyStatus(STATUS.ERROR, { failedCount: remainingFailed });
          } else if (remainingPending === 0) {
            notifyStatus(STATUS.IDLE);
          }
        } finally {
          _isProcessing = false;
          _currentProcessPromise = null;
          _processAgain = false;
        }

        return this.getStatus();
      })();

      return _currentProcessPromise;
    },

    /**
     * Resets a failed or permanent-error item back to pending and triggers sync.
     */
    retry(itemId) {
      const uid = _userId;
      if (!uid) return false;

      const queue = readQueue(uid);
      const item = queue.find(q => q.id === itemId);
      if (!item) return false;

      item.status = 'pending';
      item.attempts = 0;
      item.lastError = null;
      item.errorType = null;
      writeQueue(uid, queue);

      _isPaused = false;
      return this.process();
    },

    /**
     * Pauses the sync queue worker.
     */
    pause() {
      _isPaused = true;
      if (_retryTimer) {
        clearTimeout(_retryTimer);
        _retryTimer = null;
      }
      notifyStatus(STATUS.PAUSED);
    },

    /**
     * Resumes the sync queue worker.
     */
    resume() {
      _isPaused = false;
      if (isOnline()) {
        return this.process();
      } else {
        notifyStatus(STATUS.PAUSED, { reason: 'offline' });
        return Promise.resolve(this.getStatus());
      }
    },

    /**
     * Clears all items in the active user's queue.
     */
    clear(userId = null) {
      const uid = userId || _userId;
      if (!uid) return;
      writeQueue(uid, []);
      _lastError = null;
      notifyStatus(STATUS.IDLE);
    },

    /**
     * Returns the current status and metrics.
     */
    getStatus() {
      const queue = readQueue();
      return {
        status: _status,
        online: isOnline(),
        isProcessing: _isProcessing,
        isPaused: _isPaused,
        pendingCount: getPendingCount(queue),
        failedCount: getFailedCount(queue),
        totalCount: queue.length,
        lastSyncAt: _lastSyncAt,
        lastError: _lastError
      };
    },

    /**
     * Returns an array of current queue items.
     */
    getPending(userId = null) {
      return readQueue(userId);
    },

    /**
     * Coalesces redundant updates in current queue.
     */
    compactQueue(userId = null) {
      const uid = userId || _userId;
      if (!uid) return [];
      const queue = readQueue(uid);
      const compacted = compactQueue(queue);
      writeQueue(uid, compacted);
      return compacted;
    },

    /**
     * Subscribes to queue item additions/modifications.
     */
    onChange(callback) {
      if (typeof callback === 'function') {
        _changeListeners.add(callback);
      }
      return () => _changeListeners.delete(callback);
    },

    /**
     * Subscribes to sync status transitions.
     */
    onStatusChange(callback) {
      if (typeof callback === 'function') {
        _statusListeners.add(callback);
      }
      return () => _statusListeners.delete(callback);
    },

    /**
     * Tears down active timers, network listeners, and resets state.
     * Leaves persisted localStorage queues intact!
     */
    destroy() {
      this.pause();
      this._unbindNetworkEvents();
      _userId = null;
      _client = null;
      _repository = null;
      _status = STATUS.IDLE;
      _isProcessing = false;
      _currentProcessPromise = null;
      _processAgain = false;
      _lastError = null;
      _changeListeners.clear();
      _statusListeners.clear();
    }
  };

  return StudyFlowSyncQueue;
});
