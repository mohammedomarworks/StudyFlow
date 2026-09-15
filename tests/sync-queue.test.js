/**
 * tests/sync-queue.test.js
 * Automated test suite for StudyFlow v2.0 Phase E:
 * - SyncQueue API & Lifecycle Management
 * - Durable Queue Storage (`sp_sync_queue_${userId}`) & Local Backup Isolation (`sp_*`)
 * - FIFO Replay Engine & Single-Worker Concurrency Lock
 * - Error Classification (Transient vs Permanent vs Auth)
 * - Exponential Backoff & Max Attempts Capping
 * - Queue Compaction (Coalescing duplicate updates, resolving create + delete)
 * - Online / Offline Lifecycle Transitions
 * - Deterministic Last-Writer-Wins Conflict Resolution during replay
 * - Zero Realtime Feedback Loops
 * - Multi-user Account Switching & Logout Worker Cleanup
 * - CloudRepository Offline Write Interception & Optimistic Return
 */

const assert = require('assert');
const path = require('path');
const SyncQueue = require('../js/sync-queue.js');
const RepositoryModule = require('../js/repository.js');
const Realtime = require('../js/realtime.js');

global.StudyFlowSyncQueue = SyncQueue;
global.StudyFlowRepository = RepositoryModule;

function setNetworkOnline(online) {
  if (typeof navigator !== 'undefined') {
    Object.defineProperty(navigator, 'onLine', {
      value: Boolean(online),
      configurable: true,
      writable: true
    });
  } else {
    global.navigator = { onLine: Boolean(online) };
  }
}

let passedCount = 0;
let failedCount = 0;

function runTest(name, fn) {
  return (async () => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passedCount++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(err);
      failedCount++;
    }
  })();
}

// Mock localStorage helper
function createMockLocalStorage() {
  const storage = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
    clear: () => { Object.keys(storage).forEach(k => delete storage[k]); },
    _dump: () => ({ ...storage })
  };
}

// Mock Supabase Client
function createMockSupabaseClient(userId = '00000000-0000-4000-8000-000000000001', dbState = {}) {
  const tables = {
    subjects: [...(dbState.subjects || [])],
    tasks: [...(dbState.tasks || [])],
    notes: [...(dbState.notes || [])],
    habits: [...(dbState.habits || [])],
    habit_completions: [...(dbState.habit_completions || [])],
    study_sessions: [...(dbState.study_sessions || [])],
    settings: [...(dbState.settings || [])]
  };

  const executedOps = [];

  const client = {
    _executedOps: executedOps,
    _tables: tables,
    auth: {
      getUser: async () => ({
        data: { user: { id: userId, email: 'test@example.com' } },
        error: null
      })
    },
    from: (tableName) => {
      let filterCol = null;
      let filterVal = null;
      let filterCol2 = null;
      let filterVal2 = null;

      const builder = {
        select: (cols) => builder,
        order: (col, opts) => builder,
        eq: (col, val) => {
          if (!filterCol) {
            filterCol = col;
            filterVal = val;
          } else {
            filterCol2 = col;
            filterVal2 = val;
          }
          return builder;
        },
        maybeSingle: async () => {
          const list = tables[tableName] || [];
          const match = list.find(r => (!filterCol || r[filterCol] === filterVal) && (!filterCol2 || r[filterCol2] === filterVal2));
          return { data: match || null, error: null };
        },
        single: async () => {
          const list = tables[tableName] || [];
          const match = list.find(r => (!filterCol || r[filterCol] === filterVal) && (!filterCol2 || r[filterCol2] === filterVal2));
          return { data: match || null, error: match ? null : { message: 'Row not found', code: 'PGRST116' } };
        },
        insert: (payload) => {
          executedOps.push({ type: 'insert', table: tableName, payload });
          const rows = Array.isArray(payload) ? payload : [payload];
          const inserted = rows.map(r => ({
            id: r.id || 'gen-' + Math.random().toString(36).slice(2, 8),
            created_at: r.created_at || new Date().toISOString(),
            updated_at: r.updated_at || new Date().toISOString(),
            ...r
          }));
          tables[tableName] = (tables[tableName] || []).concat(inserted);
          return {
            select: () => ({
              single: async () => ({ data: inserted[0], error: null })
            })
          };
        },
        upsert: (payload, opts) => {
          executedOps.push({ type: 'upsert', table: tableName, payload, opts });
          const rows = Array.isArray(payload) ? payload : [payload];
          const list = tables[tableName] || [];
          const upserted = rows.map(r => {
            const conflictKey = (opts && opts.onConflict) || 'id';
            const keys = conflictKey.split(',').map(s => s.trim());
            const existingIdx = list.findIndex(item => keys.every(k => item[k] === r[k]));
            const row = {
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              ...r
            };
            if (existingIdx !== -1) {
              list[existingIdx] = { ...list[existingIdx], ...row };
              return list[existingIdx];
            } else {
              if (!row.id) row.id = 'gen-' + Math.random().toString(36).slice(2, 8);
              list.push(row);
              return row;
            }
          });
          tables[tableName] = list;
          return {
            select: () => ({
              single: async () => ({ data: upserted[0], error: null })
            })
          };
        },
        update: (payload) => {
          executedOps.push({ type: 'update', table: tableName, payload });
          return {
            eq: (c1, v1) => ({
              eq: (c2, v2) => ({
                select: () => ({
                  single: async () => {
                    const list = tables[tableName] || [];
                    const idx = list.findIndex(r => r[c1] === v1 && r[c2] === v2);
                    if (idx !== -1) {
                      list[idx] = { ...list[idx], ...payload, updated_at: new Date().toISOString() };
                      return { data: list[idx], error: null };
                    }
                    return { data: null, error: { message: 'Row not found' } };
                  }
                })
              })
            })
          };
        },
        delete: () => {
          executedOps.push({ type: 'delete', table: tableName });
          return {
            eq: (c1, v1) => {
              const filterEq = {
                eq: (c2, v2) => {
                  const list = tables[tableName] || [];
                  tables[tableName] = list.filter(r => !(r[c1] === v1 && r[c2] === v2));
                  return Promise.resolve({ error: null });
                }
              };
              filterEq.then = (resolve, reject) => {
                const list = tables[tableName] || [];
                tables[tableName] = list.filter(r => r[c1] !== v1);
                return Promise.resolve({ error: null }).then(resolve, reject);
              };
              return filterEq;
            }
          };
        }
      };

      return builder;
    }
  };

  return client;
}

// Test Runner
async function runAllTests() {
  console.log('\nRunning StudyFlow v2.0 Phase E (Offline Resilience & Sync Queue) Test Suite...\n');

  const USER_A = '11111111-1111-4000-8000-111111111111';
  const USER_B = '22222222-2222-4000-8000-222222222222';

  // --------------------------------------------------------------------------
  // Test 1: Public API interface completeness
  // --------------------------------------------------------------------------
  await runTest('1. SyncQueue public API exposes all required lifecycle and queue methods', () => {
    assert.strictEqual(typeof SyncQueue.init, 'function');
    assert.strictEqual(typeof SyncQueue.enqueue, 'function');
    assert.strictEqual(typeof SyncQueue.process, 'function');
    assert.strictEqual(typeof SyncQueue.retry, 'function');
    assert.strictEqual(typeof SyncQueue.pause, 'function');
    assert.strictEqual(typeof SyncQueue.resume, 'function');
    assert.strictEqual(typeof SyncQueue.clear, 'function');
    assert.strictEqual(typeof SyncQueue.getStatus, 'function');
    assert.strictEqual(typeof SyncQueue.getPending, 'function');
    assert.strictEqual(typeof SyncQueue.compactQueue, 'function');
    assert.strictEqual(typeof SyncQueue.onChange, 'function');
    assert.strictEqual(typeof SyncQueue.onStatusChange, 'function');
    assert.strictEqual(typeof SyncQueue.destroy, 'function');
  });

  // --------------------------------------------------------------------------
  // Test 2: Storage key isolation
  // --------------------------------------------------------------------------
  await runTest('2. Queue is isolated in sp_sync_queue_${userId} and does not touch sp_* local keys', () => {
    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;
    setNetworkOnline(false);

    SyncQueue.init({ userId: USER_A });
    SyncQueue.enqueue({
      userId: USER_A,
      action: 'saveTask',
      table: 'tasks',
      recordId: 'task-1',
      payload: { title: 'Test Task' }
    });

    // sp_sync_queue_${USER_A} must exist
    const rawQueue = mockStorage.getItem(`sp_sync_queue_${USER_A}`);
    assert(rawQueue, 'Queue must be stored under sp_sync_queue_${userId}');
    const parsed = JSON.parse(rawQueue);
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].recordId, 'task-1');

    // Local v1.5.0 backup keys must NOT have been touched by sync-queue
    const allKeys = Object.keys(mockStorage._dump());
    const touchedLocalKeys = allKeys.filter(k => k === 'sp_tasks' || k === 'sp_subjects' || k === 'sp_notes');
    assert.strictEqual(touchedLocalKeys.length, 0, 'SyncQueue must never touch v1.5.0 local backup keys');

    SyncQueue.destroy();
  });

  // --------------------------------------------------------------------------
  // Test 3: Queue entry schema compliance
  // --------------------------------------------------------------------------
  await runTest('3. Enqueued entries conform to schema (id, userId, action, table, recordId, payload, status, attempts)', () => {
    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;
    setNetworkOnline(false);
    SyncQueue.init({ userId: USER_A });

    const item = SyncQueue.enqueue({
      userId: USER_A,
      action: 'saveSubject',
      table: 'subjects',
      recordId: 'sub-101',
      payload: { name: 'Mathematics' }
    });

    assert(item.id.startsWith('q_'), 'Item ID should have q_ prefix');
    assert.strictEqual(item.userId, USER_A);
    assert.strictEqual(item.action, 'saveSubject');
    assert.strictEqual(item.table, 'subjects');
    assert.strictEqual(item.recordId, 'sub-101');
    assert.strictEqual(item.status, 'pending');
    assert.strictEqual(item.attempts, 0);
    assert.strictEqual(item.maxAttempts, 5);
    assert(item.createdAt, 'Item must have createdAt ISO string');
    assert.strictEqual(item.lastError, null);

    SyncQueue.destroy();
  });

  // --------------------------------------------------------------------------
  // Test 4: FIFO Replay order preservation
  // --------------------------------------------------------------------------
  await runTest('4. Queue replays mutations in strict FIFO sequence', async () => {
    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;
    setNetworkOnline(false); // offline initially

    const executionLog = [];
    const mockRepo = {
      saveSubject: async (p) => { executionLog.push(`saveSubject:${p.name}`); return p; },
      saveTask: async (p) => { executionLog.push(`saveTask:${p.title}`); return p; },
      deleteSubject: async (id) => { executionLog.push(`deleteSubject:${id}`); return true; }
    };

    SyncQueue.init({ userId: USER_A, repository: mockRepo });
    SyncQueue.enqueue({ userId: USER_A, action: 'saveSubject', table: 'subjects', recordId: 's1', payload: { name: 'Subject 1' } });
    SyncQueue.enqueue({ userId: USER_A, action: 'saveTask', table: 'tasks', recordId: 't1', payload: { title: 'Task 1' } });
    SyncQueue.enqueue({ userId: USER_A, action: 'deleteSubject', table: 'subjects', recordId: 's1' });

    assert.strictEqual(SyncQueue.getPending(USER_A).length, 3);

    // Come back online and process
    setNetworkOnline(true);
    await SyncQueue.process();

    assert.deepStrictEqual(executionLog, [
      'saveSubject:Subject 1',
      'saveTask:Task 1',
      'deleteSubject:s1'
    ]);

    // Queue should now be completely empty
    assert.strictEqual(SyncQueue.getPending(USER_A).length, 0);
    assert.strictEqual(SyncQueue.getStatus().pendingCount, 0);

    SyncQueue.destroy();
  });

  // --------------------------------------------------------------------------
  // Test 5: Single Worker concurrency lock
  // --------------------------------------------------------------------------
  await runTest('5. Single-worker lock prevents duplicate parallel execution runs', async () => {
    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;
    setNetworkOnline(true);

    let activeWorkerCount = 0;
    let maxConcurrentWorkers = 0;
    let totalExecutions = 0;

    const mockRepo = {
      saveTask: async (p) => {
        activeWorkerCount++;
        maxConcurrentWorkers = Math.max(maxConcurrentWorkers, activeWorkerCount);
        // Simulate async I/O delay
        await new Promise(r => setTimeout(r, 25));
        activeWorkerCount--;
        totalExecutions++;
        return p;
      }
    };

    SyncQueue.init({ userId: USER_A, repository: mockRepo });
    SyncQueue.pause(); // pause so enqueue does not auto-process
    SyncQueue.enqueue({ userId: USER_A, action: 'saveTask', table: 'tasks', recordId: 't1', payload: { title: 'Task 1' } });

    SyncQueue.resume();
    // Fire 4 parallel process() calls simultaneously
    const results = await Promise.all([
      SyncQueue.process(),
      SyncQueue.process(),
      SyncQueue.process(),
      SyncQueue.process()
    ]);

    assert.strictEqual(maxConcurrentWorkers, 1, 'Only one worker must run at a time');
    assert.strictEqual(totalExecutions, 1, 'Task must only be executed once');

    SyncQueue.destroy();
  });

  // --------------------------------------------------------------------------
  // Test 6: Transient error retry & attempt increment
  // --------------------------------------------------------------------------
  await runTest('6. Transient fetch failure increments attempt counter and sets failed status', async () => {
    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;
    setNetworkOnline(true);

    let attemptCount = 0;
    const mockRepo = {
      saveTask: async () => {
        attemptCount++;
        const networkError = new Error('TypeError: fetch failed');
        networkError.status = 0;
        throw networkError;
      }
    };

    SyncQueue.init({ userId: USER_A, repository: mockRepo });
    SyncQueue.pause();
    SyncQueue.enqueue({ userId: USER_A, action: 'saveTask', table: 'tasks', recordId: 't1', payload: { title: 'Task 1' } });

    SyncQueue.resume();
    await SyncQueue.process();

    const pending = SyncQueue.getPending(USER_A);
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].attempts, 1);
    assert.strictEqual(pending[0].status, 'failed');
    assert.strictEqual(pending[0].errorType, 'transient');
    assert(pending[0].lastError.includes('fetch failed'));

    SyncQueue.destroy();
  });

  // --------------------------------------------------------------------------
  // Test 7: Permanent error isolation (no infinite retry loop)
  // --------------------------------------------------------------------------
  await runTest('7. Permanent schema or RLS error is marked permanent_error and does not loop forever', async () => {
    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;
    setNetworkOnline(true);

    let attempts = 0;
    const mockRepo = {
      saveTask: async () => {
        attempts++;
        const rlsError = new Error('new row violates row-level security policy for table tasks');
        rlsError.code = '42501';
        rlsError.status = 403;
        throw rlsError;
      }
    };

    SyncQueue.init({ userId: USER_A, repository: mockRepo });
    SyncQueue.pause();
    SyncQueue.enqueue({ userId: USER_A, action: 'saveTask', table: 'tasks', recordId: 't-invalid', payload: { title: 'Task' } });

    SyncQueue.resume();
    await SyncQueue.process();

    const pending = SyncQueue.getPending(USER_A);
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].status, 'permanent_error');
    assert.strictEqual(pending[0].errorType, 'permanent');
    assert.strictEqual(attempts, 1, 'Should not automatically retry permanent errors');

    // Calling process() again does not re-attempt permanent error
    await SyncQueue.process();
    assert.strictEqual(attempts, 1);

    SyncQueue.destroy();
  });

  // --------------------------------------------------------------------------
  // Test 8: Queue compaction - coalescing multiple updates
  // --------------------------------------------------------------------------
  await runTest('8. Multiple sequential updates to same entity coalesce into single latest mutation', () => {
    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;
    setNetworkOnline(false);

    SyncQueue.init({ userId: USER_A });

    // Enqueue 3 successive task updates
    SyncQueue.enqueue({
      userId: USER_A,
      action: 'saveTask',
      table: 'tasks',
      recordId: 'task-100',
      payload: { id: 'task-100', title: 'Draft title', priority: 'low' }
    });
    SyncQueue.enqueue({
      userId: USER_A,
      action: 'saveTask',
      table: 'tasks',
      recordId: 'task-100',
      payload: { id: 'task-100', title: 'Revised title', priority: 'medium' }
    });
    SyncQueue.enqueue({
      userId: USER_A,
      action: 'saveTask',
      table: 'tasks',
      recordId: 'task-100',
      payload: { id: 'task-100', title: 'Final title', priority: 'high' }
    });

    const pending = SyncQueue.getPending(USER_A);
    assert.strictEqual(pending.length, 1, 'Compaction should merge into a single item');
    assert.strictEqual(pending[0].payload.title, 'Final title');
    assert.strictEqual(pending[0].payload.priority, 'high');

    SyncQueue.destroy();
  });

  // --------------------------------------------------------------------------
  // Test 9: Queue compaction - create offline then delete offline
  // --------------------------------------------------------------------------
  await runTest('9. Un-synced offline creation followed by deletion prunes both operations', () => {
    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;
    setNetworkOnline(false);

    SyncQueue.init({ userId: USER_A });

    // Local task created offline with local ID
    SyncQueue.enqueue({
      userId: USER_A,
      action: 'saveTask',
      table: 'tasks',
      recordId: 'task-temp-999',
      payload: { id: 'task-temp-999', title: 'Temporary task' }
    });
    assert.strictEqual(SyncQueue.getPending(USER_A).length, 1);

    // Later deleted offline before sync
    SyncQueue.enqueue({
      userId: USER_A,
      action: 'deleteTask',
      table: 'tasks',
      recordId: 'task-temp-999'
    });

    assert.strictEqual(SyncQueue.getPending(USER_A).length, 0, 'Both create and delete should cancel out');

    SyncQueue.destroy();
  });

  // --------------------------------------------------------------------------
  // Test 10: Online/offline transition handling
  // --------------------------------------------------------------------------
  await runTest('10. Queue pauses when offline and flushes when online', async () => {
    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;
    setNetworkOnline(false);

    let executed = false;
    const mockRepo = {
      saveSubject: async () => { executed = true; return {}; }
    };

    SyncQueue.init({ userId: USER_A, repository: mockRepo });
    SyncQueue.enqueue({ userId: USER_A, action: 'saveSubject', table: 'subjects', recordId: 's1', payload: {} });

    // Attempt process while offline
    const res = await SyncQueue.process();
    assert.strictEqual(res.status, 'paused');
    assert.strictEqual(executed, false);

    // Switch online
    setNetworkOnline(true);
    SyncQueue.resume();
    await SyncQueue.process();

    assert.strictEqual(executed, true);
    assert.strictEqual(SyncQueue.getPending(USER_A).length, 0);

    SyncQueue.destroy();
  });

  // --------------------------------------------------------------------------
  // Test 11: Manual retry resets failed item and syncs
  // --------------------------------------------------------------------------
  await runTest('11. retry(itemId) resets failed item to pending and executes processing', async () => {
    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;
    setNetworkOnline(true);

    let shouldFail = true;
    let executionCount = 0;
    const mockRepo = {
      saveTask: async () => {
        executionCount++;
        if (shouldFail) {
          const err = new Error('Network timeout');
          err.status = 408;
          throw err;
        }
        return {};
      }
    };

    SyncQueue.init({ userId: USER_A, repository: mockRepo });
    SyncQueue.pause();
    const item = SyncQueue.enqueue({ userId: USER_A, action: 'saveTask', table: 'tasks', recordId: 't1', payload: {} });

    SyncQueue.resume();
    await SyncQueue.process();
    assert.strictEqual(SyncQueue.getPending(USER_A)[0].status, 'failed');

    // Network recovers
    shouldFail = false;
    await SyncQueue.retry(item.id);

    assert.strictEqual(executionCount, 2);
    assert.strictEqual(SyncQueue.getPending(USER_A).length, 0);

    SyncQueue.destroy();
  });

  // --------------------------------------------------------------------------
  // Test 12: Last-Writer-Wins Conflict Resolution during replay
  // --------------------------------------------------------------------------
  await runTest('12. Stale queued write is safely rejected if remote cloud row has newer timestamp', async () => {
    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;
    setNetworkOnline(true);

    const serverNow = new Date().toISOString();
    const olderTime = new Date(Date.now() - 60000).toISOString(); // 1 minute ago

    // Cloud has task updated by another device at serverNow
    const mockClient = createMockSupabaseClient(USER_A, {
      tasks: [{
        id: '20000000-0000-4000-8000-000000000001',
        user_id: USER_A,
        title: 'Title updated on Laptop',
        updated_at: serverNow
      }]
    });

    let localRepoWriteCalled = false;
    const mockRepo = {
      saveTask: async (p) => { localRepoWriteCalled = true; return p; }
    };

    SyncQueue.init({ userId: USER_A, supabaseClient: mockClient, repository: mockRepo });
    SyncQueue.pause();

    // Offline queue has a stale update made before serverNow
    SyncQueue.enqueue({
      userId: USER_A,
      action: 'saveTask',
      table: 'tasks',
      recordId: '20000000-0000-4000-8000-000000000001',
      payload: { id: '20000000-0000-4000-8000-000000000001', title: 'Stale offline title' },
      createdAt: olderTime
    });

    SyncQueue.resume();
    await SyncQueue.process();

    // Outbound write to repo was skipped due to LWW conflict
    assert.strictEqual(localRepoWriteCalled, false, 'Stale local write must not overwrite newer remote record');
    // Stale item was safely resolved and removed from queue
    assert.strictEqual(SyncQueue.getPending(USER_A).length, 0);

    SyncQueue.destroy();
  });

  // --------------------------------------------------------------------------
  // Test 13: Zero feedback loops (Realtime events never trigger sync queue)
  // --------------------------------------------------------------------------
  await runTest('13. Realtime remote events never enqueue writes to SyncQueue', () => {
    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;

    SyncQueue.init({ userId: USER_A });
    assert.strictEqual(SyncQueue.getPending(USER_A).length, 0);

    // Apply remote realtime event directly
    Realtime.applyRemoteEvent('tasks', 'INSERT', {
      id: '30000000-0000-4000-8000-000000000001',
      user_id: USER_A,
      title: 'Task from Phone',
      created_at: new Date().toISOString()
    }, null, USER_A);

    // Verify item is in cloud cache
    const cloudTasks = JSON.parse(mockStorage.getItem(`sp_cloud_sp_tasks_${USER_A}`));
    assert.strictEqual(cloudTasks.length, 1);

    // CRITICAL: SyncQueue must remain completely empty!
    assert.strictEqual(SyncQueue.getPending(USER_A).length, 0, 'Inbound realtime events must NEVER enqueue writes');

    SyncQueue.destroy();
  });

  // --------------------------------------------------------------------------
  // Test 14: Multi-user Account Switching and Queue Isolation
  // --------------------------------------------------------------------------
  await runTest('14. Switching accounts switches queue scope without data leakage', () => {
    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;
    setNetworkOnline(false);

    // User A queues an item
    SyncQueue.init({ userId: USER_A });
    SyncQueue.enqueue({ userId: USER_A, action: 'saveTask', table: 'tasks', recordId: 't-user-a', payload: { title: 'User A Task' } });
    assert.strictEqual(SyncQueue.getPending(USER_A).length, 1);

    // User logs out & User B logs in
    SyncQueue.destroy();
    SyncQueue.init({ userId: USER_B });
    assert.strictEqual(SyncQueue.getPending(USER_B).length, 0, 'User B must start with empty queue');

    SyncQueue.enqueue({ userId: USER_B, action: 'saveNote', table: 'notes', recordId: 'n-user-b', payload: { title: 'User B Note' } });
    assert.strictEqual(SyncQueue.getPending(USER_B).length, 1);

    // Verify storage keys remain completely isolated
    const queueA = JSON.parse(mockStorage.getItem(`sp_sync_queue_${USER_A}`));
    const queueB = JSON.parse(mockStorage.getItem(`sp_sync_queue_${USER_B}`));
    assert.strictEqual(queueA[0].recordId, 't-user-a');
    assert.strictEqual(queueB[0].recordId, 'n-user-b');

    SyncQueue.destroy();
  });

  // --------------------------------------------------------------------------
  // Test 15: Logout worker cleanup preserves stored queue for return
  // --------------------------------------------------------------------------
  await runTest('15. destroy() halts worker but leaves persisted localStorage queue intact', () => {
    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;
    setNetworkOnline(false);

    SyncQueue.init({ userId: USER_A });
    SyncQueue.enqueue({ userId: USER_A, action: 'saveTask', table: 'tasks', recordId: 't1', payload: {} });
    assert.strictEqual(SyncQueue.getPending(USER_A).length, 1);

    // User signs out -> destroy() called
    SyncQueue.destroy();

    // Verify localStorage key STILL exists and has the pending item
    const raw = mockStorage.getItem(`sp_sync_queue_${USER_A}`);
    assert(raw !== null, 'Durable queue must NOT be deleted on sign out');
    const restored = JSON.parse(raw);
    assert.strictEqual(restored.length, 1);
    assert.strictEqual(restored[0].recordId, 't1');
  });

  // --------------------------------------------------------------------------
  // Test 16: CloudRepository write interception when offline
  // --------------------------------------------------------------------------
  await runTest('16. CloudRepository intercepts offline write and delegates to SyncQueue optimistically', async () => {
    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;
    setNetworkOnline(false); // offline

    const mockClient = createMockSupabaseClient(USER_A);
    const repo = new RepositoryModule.CloudRepository(mockClient);

    SyncQueue.init({ userId: USER_A, repository: repo });
    RepositoryModule.RepositoryFactory.setMode('cloud', USER_A);

    const taskPayload = {
      id: '40000000-0000-4000-8000-000000000001',
      title: 'Offline Task Creation',
      priority: 'high'
    };

    // saveTask while offline should NOT throw, but enqueue to SyncQueue
    const result = await repo.saveTask(taskPayload);
    assert.strictEqual(result.id, taskPayload.id);

    const pending = SyncQueue.getPending(USER_A);
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].action, 'saveTask');
    assert.strictEqual(pending[0].table, 'tasks');
    assert.strictEqual(pending[0].recordId, taskPayload.id);

    SyncQueue.destroy();
    RepositoryModule.RepositoryFactory.setMode('local');
  });

  // --------------------------------------------------------------------------
  // Test 17: Habit completions toggle and set offline handling
  // --------------------------------------------------------------------------
  await runTest('17. Habit completion set and toggle operations enqueue offline cleanly', async () => {
    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;
    setNetworkOnline(false);

    const mockClient = createMockSupabaseClient(USER_A);
    const repo = new RepositoryModule.CloudRepository(mockClient);

    SyncQueue.init({ userId: USER_A, repository: repo });
    RepositoryModule.RepositoryFactory.setMode('cloud', USER_A);

    // Set habit completion offline
    const res = await repo.setHabitCompletion('hbt-1', '2026-09-15', true);
    assert.strictEqual(res, true);

    const pending = SyncQueue.getPending(USER_A);
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].action, 'setHabitCompletion');
    assert.strictEqual(pending[0].recordId, 'hbt-1');
    assert.strictEqual(pending[0].secondaryId, '2026-09-15');
    assert.strictEqual(pending[0].payload.completed, true);

    SyncQueue.destroy();
    RepositoryModule.RepositoryFactory.setMode('local');
  });

  // --------------------------------------------------------------------------
  // Test 18: Settings save offline resilience
  // --------------------------------------------------------------------------
  await runTest('18. Settings modifications while offline are safely enqueued', async () => {
    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;
    setNetworkOnline(false);

    const mockClient = createMockSupabaseClient(USER_A);
    const repo = new RepositoryModule.CloudRepository(mockClient);

    SyncQueue.init({ userId: USER_A, repository: repo });
    RepositoryModule.RepositoryFactory.setMode('cloud', USER_A);

    const settingsUpdate = { theme: 'dark', pomodoro: { focus: 50, shortBreak: 10 } };
    const res = await repo.saveSettings(settingsUpdate);
    assert.strictEqual(res.theme, 'dark');

    const pending = SyncQueue.getPending(USER_A);
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].action, 'saveSettings');
    assert.strictEqual(pending[0].table, 'settings');

    SyncQueue.destroy();
    RepositoryModule.RepositoryFactory.setMode('local');
  });

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log('\n========================================');
  console.log(`SyncQueue Test Results: ${passedCount} passed, ${failedCount} failed`);
  console.log('========================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
