/**
 * tests/realtime.test.js
 * Automated test suite for StudyFlow v2.0 Phase D:
 * - Realtime Manager API & Lifecycle
 * - Subscription gating (Authenticated + Cloud Mode only)
 * - Remote INSERT / UPDATE / DELETE cache updates (sp_cloud_* only)
 * - Deterministic Last-Writer-Wins conflict policy & Stale-event rejection
 * - Feedback loop prevention (zero write-back calls)
 * - Untouched local backup keys (sp_*)
 * - Form edit safety & Listener deduplication
 */

const assert = require('assert');
const path = require('path');
const Realtime = require('../js/realtime.js');
const RepositoryModule = require('../js/repository.js');
const Migration = require('../js/migration.js');

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

// Mock Supabase Realtime channel and client
function createMockSupabaseClient(userId = '00000000-0000-4000-8000-000000000001') {
  const channels = [];
  let writeCallCount = 0;

  const client = {
    _writeCallCount: () => writeCallCount,
    _channels: channels,
    auth: {
      getUser: async () => ({
        data: { user: { id: userId, email: 'test@example.com', user_metadata: { display_name: 'Test Student' } } },
        error: null
      })
    },
    from: (table) => {
      return {
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
            single: () => Promise.resolve({ data: null, error: null })
          })
        }),
        insert: (payload) => {
          writeCallCount++;
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: 'test-id', ...payload, created_at: new Date().toISOString() }, error: null })
            })
          };
        },
        update: (payload) => {
          writeCallCount++;
          return {
            eq: () => ({
              eq: () => ({
                select: () => ({
                  single: () => Promise.resolve({ data: { id: 'test-id', ...payload, updated_at: new Date().toISOString() }, error: null })
                })
              })
            })
          };
        },
        delete: () => {
          writeCallCount++;
          return {
            eq: () => ({
              eq: () => Promise.resolve({ error: null })
            })
          };
        }
      };
    },
    channel: (name) => {
      const handlers = {};
      let subCallback = null;
      let isUnsubscribed = false;

      const ch = {
        name,
        handlers,
        isUnsubscribed: () => isUnsubscribed,
        on: (type, filter, handler) => {
          const key = `${filter.table}:${filter.event}`;
          handlers[key] = handler;
          return ch;
        },
        subscribe: (cb) => {
          subCallback = cb;
          setTimeout(() => {
            if (cb) cb('SUBSCRIBED', null);
          }, 0);
          return ch;
        },
        unsubscribe: async () => {
          isUnsubscribed = true;
          return 'ok';
        },
        // Test helper to simulate incoming postgres change event
        _emitChange: (table, eventType, newRow, oldRow) => {
          const starKey = `${table}:*`;
          const specificKey = `${table}:${eventType}`;
          const handler = handlers[starKey] || handlers[specificKey];
          if (handler) {
            handler({
              eventType,
              new: newRow,
              old: oldRow,
              table,
              commit_timestamp: new Date().toISOString()
            });
          }
        }
      };
      channels.push(ch);
      return ch;
    },
    removeChannel: async (ch) => {
      if (ch && typeof ch.unsubscribe === 'function') {
        await ch.unsubscribe();
      }
      const idx = channels.indexOf(ch);
      if (idx !== -1) channels.splice(idx, 1);
      return 'ok';
    }
  };

  return client;
}

(async function () {
  console.log('Running StudyFlow v2.0 Phase D (Realtime & Conflict Handling) Test Suite...\n');

  const userId = '00000000-0000-4000-8000-000000000001';

  // 1. Realtime manager API exists
  await runTest('1. Realtime manager API exists with complete interface', async () => {
    assert.strictEqual(typeof Realtime.initialize, 'function');
    assert.strictEqual(typeof Realtime.subscribe, 'function');
    assert.strictEqual(typeof Realtime.unsubscribe, 'function');
    assert.strictEqual(typeof Realtime.destroy, 'function');
    assert.strictEqual(typeof Realtime.pause, 'function');
    assert.strictEqual(typeof Realtime.resume, 'function');
    assert.strictEqual(typeof Realtime.getStatus, 'function');
    assert.strictEqual(typeof Realtime.getLastSynced, 'function');
    assert.strictEqual(typeof Realtime.onChange, 'function');
    assert.strictEqual(typeof Realtime.onStatusChange, 'function');
    assert.strictEqual(typeof Realtime.applyRemoteEvent, 'function');
    assert.strictEqual(typeof Realtime.STATUS, 'object');
    assert.strictEqual(Realtime.STATUS.DISCONNECTED, 'disconnected');
    assert.strictEqual(Realtime.STATUS.CONNECTED, 'connected');
  });

  // 2. initialize does not create duplicate subscriptions if called repeatedly
  await runTest('2. initialize is idempotent and does not create duplicate channels', async () => {
    Realtime.reset();
    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;

    const mockClient = createMockSupabaseClient(userId);
    const user = { id: userId, email: 'test@example.com' };

    Realtime.initialize(user, { supabaseClient: mockClient });
    await Realtime.subscribe({ mode: 'cloud', supabaseClient: mockClient });

    assert.strictEqual(Realtime.getStatus(), 'connected');
    assert.strictEqual(mockClient._channels.length, 1);

    // Call initialize again with same user
    Realtime.initialize(user, { supabaseClient: mockClient });
    await Realtime.subscribe({ mode: 'cloud', supabaseClient: mockClient });

    // Should still only have 1 active channel
    assert.strictEqual(mockClient._channels.length, 1);
    assert.strictEqual(Realtime.getStatus(), 'connected');

    await Realtime.destroy();
  });

  // 3. unsubscribe cleans up channel and updates status
  await runTest('3. unsubscribe cleans up channel and sets status to disconnected', async () => {
    Realtime.reset();
    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;

    const mockClient = createMockSupabaseClient(userId);
    const user = { id: userId, email: 'test@example.com' };

    Realtime.initialize(user, { supabaseClient: mockClient });
    await Realtime.subscribe({ mode: 'cloud', supabaseClient: mockClient });
    assert.strictEqual(Realtime.getStatus(), 'connected');

    await Realtime.unsubscribe();
    assert.strictEqual(Realtime.getStatus(), 'disconnected');

    await Realtime.destroy();
  });

  // 4. Remote INSERT updates the correct cloud cache
  await runTest('4. Remote INSERT updates sp_cloud_*_${userId} correctly', async () => {
    Realtime.reset();
    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;

    const taskRow = {
      id: 'task-uuid-1',
      user_id: userId,
      title: 'Realtime Chemistry Study',
      category: 'Revision',
      priority: 'high',
      due_date: '2026-09-20',
      estimate_minutes: 45,
      completed: false,
      completed_at: null,
      subject_id: null,
      created_at: '2026-09-15T12:00:00.000Z',
      updated_at: '2026-09-15T12:00:00.000Z'
    };

    const res = Realtime.applyRemoteEvent('tasks', 'INSERT', taskRow, null, userId);
    assert.strictEqual(res.applied, true);
    assert.strictEqual(res.eventType, 'INSERT');

    const cacheRaw = mockStorage.getItem(`sp_cloud_sp_tasks_${userId}`);
    assert.ok(cacheRaw, 'Cloud cache should exist');
    const cache = JSON.parse(cacheRaw);
    assert.strictEqual(cache.length, 1);
    assert.strictEqual(cache[0].id, 'task-uuid-1');
    assert.strictEqual(cache[0].title, 'Realtime Chemistry Study');
    assert.strictEqual(cache[0].priority, 'high');
  });

  // 5. Remote UPDATE updates the cached record
  await runTest('5. Remote UPDATE updates the existing cached record', async () => {
    Realtime.reset();
    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;

    // Seed existing cached task
    const initialTasks = [{
      id: 'task-uuid-1',
      title: 'Original Title',
      completed: false,
      createdAt: '2026-09-15T10:00:00.000Z',
      updatedAt: '2026-09-15T10:00:00.000Z'
    }];
    mockStorage.setItem(`sp_cloud_sp_tasks_${userId}`, JSON.stringify(initialTasks));

    const updatedRow = {
      id: 'task-uuid-1',
      user_id: userId,
      title: 'Updated Remotely Title',
      completed: true,
      completed_at: '2026-09-15T14:00:00.000Z',
      created_at: '2026-09-15T10:00:00.000Z',
      updated_at: '2026-09-15T14:00:00.000Z'
    };

    const res = Realtime.applyRemoteEvent('tasks', 'UPDATE', updatedRow, null, userId);
    assert.strictEqual(res.applied, true);

    const cache = JSON.parse(mockStorage.getItem(`sp_cloud_sp_tasks_${userId}`));
    assert.strictEqual(cache.length, 1);
    assert.strictEqual(cache[0].title, 'Updated Remotely Title');
    assert.strictEqual(cache[0].completed, true);
  });

  // 6. Remote DELETE removes the cached record
  await runTest('6. Remote DELETE removes the item from cloud cache', async () => {
    Realtime.reset();
    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;

    const initialTasks = [
      { id: 'task-uuid-1', title: 'Task 1' },
      { id: 'task-uuid-2', title: 'Task 2' }
    ];
    mockStorage.setItem(`sp_cloud_sp_tasks_${userId}`, JSON.stringify(initialTasks));

    const res = Realtime.applyRemoteEvent('tasks', 'DELETE', null, { id: 'task-uuid-1', user_id: userId }, userId);
    assert.strictEqual(res.applied, true);
    assert.strictEqual(res.eventType, 'DELETE');

    const cache = JSON.parse(mockStorage.getItem(`sp_cloud_sp_tasks_${userId}`));
    assert.strictEqual(cache.length, 1);
    assert.strictEqual(cache[0].id, 'task-uuid-2');
  });

  // 7. Stale UPDATE does not overwrite newer cached state (LWW Conflict Policy)
  await runTest('7. Stale UPDATE (older timestamp) is rejected by Last-Writer-Wins policy', async () => {
    Realtime.reset();
    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;

    // Cache has newer version (timestamp 15:00:00)
    const currentTasks = [{
      id: 'task-uuid-1',
      title: 'Newer Local Edit',
      completed: true,
      updatedAt: '2026-09-15T15:00:00.000Z'
    }];
    mockStorage.setItem(`sp_cloud_sp_tasks_${userId}`, JSON.stringify(currentTasks));

    // Remote event arrives late with an older timestamp (14:00:00)
    const staleRow = {
      id: 'task-uuid-1',
      user_id: userId,
      title: 'Stale Remote Edit',
      completed: false,
      updated_at: '2026-09-15T14:00:00.000Z'
    };

    const res = Realtime.applyRemoteEvent('tasks', 'UPDATE', staleRow, null, userId);
    assert.strictEqual(res.applied, false, 'Stale event should not be applied');
    assert.strictEqual(res.reason, 'stale_event');

    // Verify cache remains the newer version
    const cache = JSON.parse(mockStorage.getItem(`sp_cloud_sp_tasks_${userId}`));
    assert.strictEqual(cache[0].title, 'Newer Local Edit');
    assert.strictEqual(cache[0].completed, true);
  });

  // 8. Remote events do not trigger outbound cloud writes (Feedback loop prevention)
  await runTest('8. Remote events update cache directly without triggering outbound cloud writes', async () => {
    Realtime.reset();
    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;

    const mockClient = createMockSupabaseClient(userId);
    const user = { id: userId, email: 'test@example.com' };

    Realtime.initialize(user, { supabaseClient: mockClient });
    await Realtime.subscribe({ mode: 'cloud', supabaseClient: mockClient });

    const channel = mockClient._channels[0];
    assert.ok(channel, 'Channel should exist');

    const initialWrites = mockClient._writeCallCount();

    // Simulate incoming remote event on channel
    channel._emitChange('tasks', 'INSERT', {
      id: 'task-uuid-99',
      user_id: userId,
      title: 'Remote Generated Task',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, null);

    // Verify cache received the task
    const cache = JSON.parse(mockStorage.getItem(`sp_cloud_sp_tasks_${userId}`) || '[]');
    assert.strictEqual(cache.length, 1);
    assert.strictEqual(cache[0].title, 'Remote Generated Task');

    // Verify outbound write calls DID NOT increase (zero write-back)
    assert.strictEqual(mockClient._writeCallCount(), initialWrites, 'Outbound writes must remain zero on remote apply');

    await Realtime.destroy();
  });

  // 9. Local backup sp_* data remains untouched
  await runTest('9. Local backup keys (sp_*) remain completely untouched by realtime events', async () => {
    Realtime.reset();
    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;

    // Local backup task
    const localBackupTasks = [{ id: 'local-task-1', title: 'Untouched Local Task' }];
    mockStorage.setItem('sp_tasks', JSON.stringify(localBackupTasks));

    const noteRow = {
      id: 'note-uuid-1',
      user_id: userId,
      title: 'Cloud Note',
      content: 'Hello Realtime',
      created_at: new Date().toISOString()
    };

    Realtime.applyRemoteEvent('notes', 'INSERT', noteRow, null, userId);

    // Check local backup keys
    const rawLocal = mockStorage.getItem('sp_tasks');
    assert.strictEqual(JSON.parse(rawLocal)[0].title, 'Untouched Local Task');
    assert.strictEqual(mockStorage.getItem('sp_notes'), null, 'sp_notes local backup must remain untouched');

    // Check cloud cache
    const rawCloud = mockStorage.getItem(`sp_cloud_sp_notes_${userId}`);
    assert.ok(rawCloud, 'sp_cloud_sp_notes should be written');
  });

  // 10. Unauthenticated mode does not subscribe
  await runTest('10. Unauthenticated mode does not subscribe to realtime', async () => {
    Realtime.reset();
    const mockClient = createMockSupabaseClient(userId);

    Realtime.initialize(null);
    const subResult = await Realtime.subscribe({ user: null, mode: 'cloud', supabaseClient: mockClient });

    assert.strictEqual(subResult, false);
    assert.strictEqual(Realtime.getStatus(), 'disconnected');
    assert.strictEqual(mockClient._channels.length, 0);
  });

  // 11. Local repository mode does not subscribe
  await runTest('11. Local repository mode does not subscribe to realtime', async () => {
    Realtime.reset();
    const mockClient = createMockSupabaseClient(userId);
    const user = { id: userId, email: 'test@example.com' };

    Realtime.initialize(user, { supabaseClient: mockClient });
    const subResult = await Realtime.subscribe({ mode: 'local', supabaseClient: mockClient });

    assert.strictEqual(subResult, false);
    assert.strictEqual(Realtime.getStatus(), 'disconnected');
    assert.strictEqual(mockClient._channels.length, 0);
  });

  // 12. Cloud mode subscribes once for authenticated user
  await runTest('12. Cloud mode establishes exactly one realtime subscription', async () => {
    Realtime.reset();
    const mockClient = createMockSupabaseClient(userId);
    const user = { id: userId, email: 'test@example.com' };

    Realtime.initialize(user, { supabaseClient: mockClient });
    const subResult = await Realtime.subscribe({ mode: 'cloud', supabaseClient: mockClient });

    assert.strictEqual(subResult, true);
    assert.strictEqual(Realtime.getStatus(), 'connected');
    assert.strictEqual(mockClient._channels.length, 1);

    await Realtime.destroy();
  });

  // 13. Logout destroys subscription
  await runTest('13. destroy() completely tears down channel and clears state on logout', async () => {
    Realtime.reset();
    const mockClient = createMockSupabaseClient(userId);
    const user = { id: userId, email: 'test@example.com' };

    Realtime.initialize(user, { supabaseClient: mockClient });
    await Realtime.subscribe({ mode: 'cloud', supabaseClient: mockClient });
    assert.strictEqual(Realtime.getStatus(), 'connected');

    await Realtime.destroy();
    assert.strictEqual(Realtime.getStatus(), 'disconnected');
    assert.strictEqual(Realtime.getUser(), null);
    assert.strictEqual(mockClient._channels.length, 0);
  });

  // 14. Migration-to-cloud starts realtime
  await runTest('14. RepositoryFactory switching to cloud mode triggers realtime subscription', async () => {
    Realtime.reset();
    RepositoryModule.RepositoryFactory.reset();

    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;

    const mockClient = createMockSupabaseClient(userId);
    RepositoryModule.RepositoryFactory.setSupabaseClient(mockClient);

    let realtimeStarted = false;
    RepositoryModule.RepositoryFactory.onModeChange(async (mode, activeId) => {
      if (mode === 'cloud' && activeId) {
        Realtime.initialize({ id: activeId }, { supabaseClient: mockClient });
        await Realtime.subscribe({ mode: 'cloud', supabaseClient: mockClient });
        realtimeStarted = true;
      }
    });

    RepositoryModule.RepositoryFactory.setMode('cloud', userId);
    await new Promise(r => setTimeout(r, 10));

    assert.strictEqual(realtimeStarted, true);
    assert.strictEqual(Realtime.getStatus(), 'connected');

    await Realtime.destroy();
    RepositoryModule.RepositoryFactory.reset();
  });

  // 15. Callbacks are not duplicated and unsubscribe handles cleanup
  await runTest('15. onChange and onStatusChange listeners work with unsubscribe functions', async () => {
    Realtime.reset();

    let statusCalls = 0;
    let changeCalls = 0;

    const unStatus = Realtime.onStatusChange(() => { statusCalls++; });
    const unChange = Realtime.onChange(() => { changeCalls++; });

    assert.strictEqual(statusCalls, 1, 'Immediate status callback on registration');

    Realtime.applyRemoteEvent('settings', 'UPDATE', { user_id: userId, theme: 'dark' }, null, userId);

    // Call unsubscribes
    unStatus();
    unChange();

    const prevStatusCalls = statusCalls;
    const prevChangeCalls = changeCalls;

    Realtime.applyRemoteEvent('settings', 'UPDATE', { user_id: userId, theme: 'light' }, null, userId);

    assert.strictEqual(statusCalls, prevStatusCalls, 'Status listener should not be called after unsubscribe');
    assert.strictEqual(changeCalls, prevChangeCalls, 'Change listener should not be called after unsubscribe');
  });

  // 16. Habit completions remote event handling
  await runTest('16. Habit completion remote INSERT and DELETE by habitId and date', async () => {
    Realtime.reset();
    const mockStorage = createMockLocalStorage();
    global.localStorage = mockStorage;

    const completionRow = {
      id: 'comp-1',
      user_id: userId,
      habit_id: 'habit-1',
      date: '2026-09-15',
      completed_at: new Date().toISOString()
    };

    const insRes = Realtime.applyRemoteEvent('habit_completions', 'INSERT', completionRow, null, userId);
    assert.strictEqual(insRes.applied, true);

    let cache = JSON.parse(mockStorage.getItem(`sp_cloud_sp_habit_completions_${userId}`));
    assert.strictEqual(cache.length, 1);
    assert.strictEqual(cache[0].habitId, 'habit-1');
    assert.strictEqual(cache[0].date, '2026-09-15');

    const delRes = Realtime.applyRemoteEvent('habit_completions', 'DELETE', null, { habit_id: 'habit-1', date: '2026-09-15' }, userId);
    assert.strictEqual(delRes.applied, true);

    cache = JSON.parse(mockStorage.getItem(`sp_cloud_sp_habit_completions_${userId}`));
    assert.strictEqual(cache.length, 0);
  });

  // Summary
  console.log(`\nRealtime Test Suite Complete: ${passedCount} passed, ${failedCount} failed.`);
  if (failedCount > 0) {
    process.exit(1);
  }
})();
