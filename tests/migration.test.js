/**
 * tests/migration.test.js
 * Comprehensive automated test suite for StudyFlow v2.0 Phase C:
 * - Migration Service (summary, preview, status, referential integrity mapping, retry idempotency)
 * - CloudRepository CRUD operations
 * - RepositoryFactory mode switching & zero data loss guarantees
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

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

console.log('Running StudyFlow v2.0 Phase C (Migration & Cloud CRUD) Test Suite...\n');

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

// Mock Supabase client helper
function createMockSupabaseClient(userId = '00000000-0000-4000-8000-000000000001') {
  const db = {
    subjects: [],
    tasks: [],
    notes: [],
    habits: [],
    habit_completions: [],
    study_sessions: [],
    settings: []
  };

  const client = {
    _db: db,
    auth: {
      getUser: async () => ({
        data: {
          user: userId ? {
            id: userId,
            email: 'tester@studyflow.app',
            user_metadata: { display_name: 'Test Student' }
          } : null
        },
        error: userId ? null : new Error('No active session')
      })
    },
    from: (table) => {
      if (!db[table]) db[table] = [];

      let filters = [];
      let orderBy = null;

      const builder = {
        select: (cols = '*') => builder,
        eq: (col, val) => {
          filters.push({ col, val });
          return builder;
        },
        order: (col, opts = {}) => {
          orderBy = { col, ascending: opts.ascending !== false };
          return builder;
        },
        insert: (rows) => {
          const rawItems = Array.isArray(rows) ? rows : [rows];
          const items = rawItems.map(item => ({
            id: item.id || `00000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padStart(12, '0')}`,
            ...item
          }));
          for (const item of items) {
            db[table].push({ ...item });
          }
          const res = { data: items, error: null };
          return {
            select: () => ({
              single: async () => ({ data: items[0] || null, error: null }),
              then: (resolve) => resolve(res)
            }),
            then: (resolve) => resolve(res)
          };
        },
        upsert: (rows, opts = {}) => {
          const items = Array.isArray(rows) ? rows : [rows];
          for (const item of items) {
            const conflictKey = (opts.onConflict || '').split(',').map(s => s.trim());
            let existingIdx = -1;
            if (conflictKey.length > 0 && conflictKey[0]) {
              existingIdx = db[table].findIndex(r => conflictKey.every(k => r[k] === item[k]));
            }
            if (existingIdx > -1) {
              db[table][existingIdx] = { ...db[table][existingIdx], ...item };
            } else {
              db[table].push({ ...item });
            }
          }
          const res = { data: items, error: null };
          return {
            select: () => ({
              single: async () => ({ data: items[0] || null, error: null }),
              then: (resolve) => resolve(res)
            }),
            then: (resolve) => resolve(res)
          };
        },
        update: (payload) => {
          const updateBuilder = {
            eq: (col, val) => {
              filters.push({ col, val });
              return updateBuilder;
            },
            select: () => ({
              single: async () => executeUpdate(payload),
              then: async (resolve) => resolve({ data: executeUpdate(payload).data, error: null })
            }),
            then: async (resolve) => resolve({ data: executeUpdate(payload).data, error: null })
          };

          function executeUpdate(dataToUpdate) {
            let updated = null;
            for (let i = 0; i < db[table].length; i++) {
              const matches = filters.every(f => db[table][i][f.col] === f.val);
              if (matches) {
                db[table][i] = { ...db[table][i], ...dataToUpdate };
                updated = db[table][i];
              }
            }
            return { data: updated, error: null };
          }

          return updateBuilder;
        },
        delete: () => {
          const deleteBuilder = {
            eq: (col, val) => {
              filters.push({ col, val });
              return deleteBuilder;
            },
            then: async (resolve) => {
              db[table] = db[table].filter(r => !filters.every(f => r[f.col] === f.val));
              resolve({ data: null, error: null });
            }
          };
          return deleteBuilder;
        },
        maybeSingle: async () => {
          let res = db[table].filter(r => filters.every(f => r[f.col] === f.val));
          return { data: res[0] || null, error: null };
        },
        single: async () => {
          let res = db[table].filter(r => filters.every(f => r[f.col] === f.val));
          return { data: res[0] || null, error: res[0] ? null : new Error('Not found') };
        },
        then: (resolve) => {
          let res = db[table].filter(r => filters.every(f => r[f.col] === f.val));
          resolve({ data: res, error: null });
        }
      };

      return builder;
    }
  };

  return client;
}

// Load runtime environment
function setupTestEnvironment() {
  const mockLocalStorage = createMockLocalStorage();
  const context = {
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    localStorage: mockLocalStorage,
    window: {},
    globalThis: {},
    document: {
      dispatchEvent: () => {}
    },
    CustomEvent: class CustomEvent {
      constructor(name, detail) {
        this.name = name;
        this.detail = detail;
      }
    }
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);

  // Load storage.js
  const storageCode = fs.readFileSync(path.resolve(__dirname, '../js/storage.js'), 'utf8') +
    '\n;globalThis.Store = Store; globalThis.Dates = Dates;';
  vm.runInContext(storageCode, context);

  // Load repository.js
  const repoCode = fs.readFileSync(path.resolve(__dirname, '../js/repository.js'), 'utf8') +
    '\n;globalThis.StudyFlowRepository = StudyFlowRepository;';
  vm.runInContext(repoCode, context);

  // Load migration.js
  const migrationCode = fs.readFileSync(path.resolve(__dirname, '../js/migration.js'), 'utf8') +
    '\n;globalThis.StudyFlowMigration = StudyFlowMigration;';
  vm.runInContext(migrationCode, context);

  // Re-seed store into localStorage
  context.Store.reseed();

  return {
    Store: context.Store,
    Dates: context.Dates,
    StudyFlowRepository: context.StudyFlowRepository,
    StudyFlowMigration: context.StudyFlowMigration,
    localStorage: mockLocalStorage,
    context
  };
}

(async () => {
  // --------------------------------------------------------------------------
  // Test 1: Migration service API surface
  // --------------------------------------------------------------------------
  await runTest('1. Migration service exposes all required public API functions', () => {
    const env = setupTestEnvironment();
    const Migration = env.StudyFlowMigration;
    assert.ok(Migration, 'Migration global must exist');
    assert.strictEqual(typeof Migration.getLocalSummary, 'function');
    assert.strictEqual(typeof Migration.preview, 'function');
    assert.strictEqual(typeof Migration.getStatus, 'function');
    assert.strictEqual(typeof Migration.isCompleted, 'function');
    assert.strictEqual(typeof Migration.migrate, 'function');
    assert.strictEqual(typeof Migration.reset, 'function');
  });

  // --------------------------------------------------------------------------
  // Test 2: Migration.getLocalSummary() computes counts from Store
  // --------------------------------------------------------------------------
  await runTest('2. Migration.getLocalSummary() accurately counts all local store entities', () => {
    const env = setupTestEnvironment();
    const summary = env.StudyFlowMigration.getLocalSummary(env.Store);
    assert.ok(summary.counts.subjects > 0, 'Count subjects');
    assert.ok(summary.counts.tasks > 0, 'Count tasks');
    assert.ok(summary.counts.notes > 0, 'Count notes');
    assert.ok(summary.counts.habits > 0, 'Count habits');
    assert.ok(summary.counts.habitCompletions > 0, 'Count habit completions');
    assert.ok(summary.counts.sessions > 0, 'Count study sessions');
    assert.strictEqual(summary.counts.hasSettings, true);
    assert.ok(summary.totalItems >= 15, 'Total local items');
  });

  // --------------------------------------------------------------------------
  // Test 3: Migration.preview() formats data and guarantees
  // --------------------------------------------------------------------------
  await runTest('3. Migration.preview() provides destination user info and safety guarantees', async () => {
    const env = setupTestEnvironment();
    const mockClient = createMockSupabaseClient('user-uuid-1234');
    const preview = await env.StudyFlowMigration.preview({
      store: env.Store,
      supabaseClient: mockClient
    });

    assert.strictEqual(preview.isAuthenticated, true);
    assert.strictEqual(preview.user.id, 'user-uuid-1234');
    assert.strictEqual(preview.user.email, 'tester@studyflow.app');
    assert.strictEqual(preview.isMigrated, false);
    assert.ok(preview.guarantees.length >= 3);
    assert.ok(preview.totalItems > 0);
  });

  // --------------------------------------------------------------------------
  // Test 4: Migration.migrate() dependency-safe upload and referential integrity
  // --------------------------------------------------------------------------
  await runTest('4. Migration.migrate() preserves referential integrity (Local IDs -> UUIDs)', async () => {
    const env = setupTestEnvironment();
    const userId = 'user-uuid-abc-123';
    const mockClient = createMockSupabaseClient(userId);

    const progressSteps = [];
    const result = await env.StudyFlowMigration.migrate({
      store: env.Store,
      supabaseClient: mockClient,
      onProgress: (info) => progressSteps.push(info.entity)
    });

    assert.strictEqual(result.success, true);
    assert.ok(result.migratedAt);

    // Verify ordering in progress
    assert.ok(progressSteps.includes('subjects'));
    assert.ok(progressSteps.includes('tasks'));
    assert.ok(progressSteps.includes('notes'));
    assert.ok(progressSteps.includes('habits'));
    assert.ok(progressSteps.includes('habit_completions'));
    assert.ok(progressSteps.includes('study_sessions'));
    assert.ok(progressSteps.includes('settings'));

    // Check rows in mock database
    const db = mockClient._db;
    assert.ok(db.subjects.length > 0, 'Subjects migrated');
    assert.ok(db.tasks.length > 0, 'Tasks migrated');
    assert.ok(db.notes.length > 0, 'Notes migrated');
    assert.ok(db.habits.length > 0, 'Habits migrated');
    assert.ok(db.habit_completions.length > 0, 'Habit completions migrated');
    assert.ok(db.study_sessions.length > 0, 'Study sessions migrated');
    assert.strictEqual(db.settings.length, 1, 'Settings migrated');

    // Verify all rows have user_id = userId
    assert.ok(db.subjects.every(s => s.user_id === userId));
    assert.ok(db.tasks.every(t => t.user_id === userId));
    assert.ok(db.notes.every(n => n.user_id === userId));
    assert.ok(db.habits.every(h => h.user_id === userId));
    assert.ok(db.habit_completions.every(c => c.user_id === userId));
    assert.ok(db.study_sessions.every(s => s.user_id === userId));

    // Verify Referential Integrity: tasks with a subject have a valid subject UUID
    const subjectUuids = new Set(db.subjects.map(s => s.id));
    const tasksWithSubj = db.tasks.filter(t => t.subject_id !== null);
    assert.ok(tasksWithSubj.length > 0, 'Has tasks linked to subjects');
    assert.ok(tasksWithSubj.every(t => subjectUuids.has(t.subject_id)), 'task.subject_id must be valid subject UUID');

    // Verify Notes referential integrity
    const notesWithSubj = db.notes.filter(n => n.subject_id !== null);
    assert.ok(notesWithSubj.every(n => subjectUuids.has(n.subject_id)), 'note.subject_id must be valid subject UUID');

    // Verify Habit completions referential integrity
    const habitUuids = new Set(db.habits.map(h => h.id));
    assert.ok(db.habit_completions.every(c => habitUuids.has(c.habit_id)), 'completion.habit_id must be valid habit UUID');

    // Verify Study Sessions referential integrity
    const taskUuids = new Set(db.tasks.map(t => t.id));
    const sessionsWithTask = db.study_sessions.filter(s => s.task_id !== null);
    assert.ok(sessionsWithTask.every(s => taskUuids.has(s.task_id)), 'session.task_id must be valid task UUID');

    // Verify migration status
    assert.strictEqual(env.StudyFlowMigration.isCompleted(userId), true);
  });

  // --------------------------------------------------------------------------
  // Test 5: Idempotency & Retry: Re-migrating does not duplicate records
  // --------------------------------------------------------------------------
  await runTest('5. Idempotent retry: subsequent migration does not duplicate records in cloud', async () => {
    const env = setupTestEnvironment();
    const userId = 'user-uuid-retry-test';
    const mockClient = createMockSupabaseClient(userId);

    // First migration
    await env.StudyFlowMigration.migrate({
      store: env.Store,
      supabaseClient: mockClient
    });

    const initialTaskCount = mockClient._db.tasks.length;
    const initialSubjectCount = mockClient._db.subjects.length;
    const initialHabitCount = mockClient._db.habits.length;

    // Second migration (retry)
    await env.StudyFlowMigration.migrate({
      store: env.Store,
      supabaseClient: mockClient
    });

    assert.strictEqual(mockClient._db.tasks.length, initialTaskCount, 'Task count unchanged on retry');
    assert.strictEqual(mockClient._db.subjects.length, initialSubjectCount, 'Subject count unchanged on retry');
    assert.strictEqual(mockClient._db.habits.length, initialHabitCount, 'Habit count unchanged on retry');
  });

  // --------------------------------------------------------------------------
  // Test 6: Zero local data loss (sp_* keys are untouched)
  // --------------------------------------------------------------------------
  await runTest('6. Local data preservation: localStorage sp_* keys are untouched after migration', async () => {
    const env = setupTestEnvironment();
    const userId = 'user-uuid-preserve-local';
    const mockClient = createMockSupabaseClient(userId);

    const localTasksBefore = env.localStorage.getItem('sp_tasks');
    const localSubjectsBefore = env.localStorage.getItem('sp_subjects');
    const localHabitsBefore = env.localStorage.getItem('sp_habits');
    const localNotesBefore = env.localStorage.getItem('sp_notes');

    await env.StudyFlowMigration.migrate({
      store: env.Store,
      supabaseClient: mockClient
    });

    const localTasksAfter = env.localStorage.getItem('sp_tasks');
    const localSubjectsAfter = env.localStorage.getItem('sp_subjects');
    const localHabitsAfter = env.localStorage.getItem('sp_habits');
    const localNotesAfter = env.localStorage.getItem('sp_notes');

    assert.strictEqual(localTasksAfter, localTasksBefore, 'sp_tasks must be identical');
    assert.strictEqual(localSubjectsAfter, localSubjectsBefore, 'sp_subjects must be identical');
    assert.strictEqual(localHabitsAfter, localHabitsBefore, 'sp_habits must be identical');
    assert.strictEqual(localNotesAfter, localNotesBefore, 'sp_notes must be identical');
  });

  // --------------------------------------------------------------------------
  // Test 7: Unauthenticated migration error handling
  // --------------------------------------------------------------------------
  await runTest('7. Migration rejects cleanly when user is unauthenticated or client is missing', async () => {
    const env = setupTestEnvironment();
    const unauthClient = createMockSupabaseClient(null);

    await assert.rejects(
      () => env.StudyFlowMigration.migrate({ store: env.Store, supabaseClient: unauthClient }),
      /You must be signed in/
    );

    await assert.rejects(
      () => env.StudyFlowMigration.migrate({ store: env.Store, supabaseClient: null }),
      /Supabase client is not configured/
    );
  });

  // --------------------------------------------------------------------------
  // Test 8: CloudRepository CRUD implementation
  // --------------------------------------------------------------------------
  await runTest('8. CloudRepository executes CRUD operations against Supabase tables', async () => {
    const env = setupTestEnvironment();
    const userId = 'user-crud-tester-999';
    const mockClient = createMockSupabaseClient(userId);
    const { CloudRepository } = env.StudyFlowRepository;

    const cloudRepo = new CloudRepository(mockClient);

    // 1. Create subject
    const subject = await cloudRepo.saveSubject({
      name: 'Advanced Chemistry',
      color: '#0d9488',
      teacher: 'Dr. Marie Curie',
      examDate: '2026-10-15'
    });
    assert.ok(subject.id);
    assert.strictEqual(subject.name, 'Advanced Chemistry');

    // 2. Read subjects
    const subjects = await cloudRepo.getSubjects();
    assert.strictEqual(subjects.length, 1);
    assert.strictEqual(subjects[0].teacher, 'Dr. Marie Curie');

    // 3. Create task linked to subject
    const task = await cloudRepo.saveTask({
      title: 'Thermodynamics Problem Set',
      subjectId: subject.id,
      priority: 'high',
      dueDate: '2026-10-10',
      estimate: 45
    });
    assert.ok(task.id);
    assert.strictEqual(task.subjectId, subject.id);
    assert.strictEqual(task.completed, false);

    // 4. Toggle task
    const toggled = await cloudRepo.toggleTask(task.id);
    assert.strictEqual(toggled, true);
    const taskAfter = await cloudRepo.getTask(task.id);
    assert.strictEqual(taskAfter.completed, true);

    // 5. Notes CRUD
    const note = await cloudRepo.saveNote({
      title: 'Enthalpy Formula',
      content: 'H = U + PV',
      subjectId: subject.id,
      tags: ['chemistry', 'thermo']
    });
    assert.ok(note.id);
    const pinned = await cloudRepo.togglePinNote(note.id);
    assert.strictEqual(pinned, true);

    // 6. Habits CRUD
    const habit = await cloudRepo.saveHabit({
      name: 'Read 20 mins',
      frequency: 'daily',
      targetDays: [0, 1, 2, 3, 4, 5, 6]
    });
    assert.ok(habit.id);
    const completed = await cloudRepo.toggleHabitCompletion(habit.id, '2026-09-15');
    assert.strictEqual(completed, true);
    const completions = await cloudRepo.getHabitCompletions(habit.id);
    assert.strictEqual(completions.length, 1);

    // 7. Study Sessions CRUD
    const session = await cloudRepo.saveSession({
      subjectId: subject.id,
      taskId: task.id,
      durationMinutes: 30,
      type: 'focus'
    });
    assert.ok(session.id);
    const sessions = await cloudRepo.getSessions();
    assert.strictEqual(sessions.length, 1);

    // 8. Settings CRUD
    const savedSettings = await cloudRepo.saveSettings({
      theme: 'dark',
      pomodoro: { focus: 30, shortBreak: 6 }
    });
    assert.strictEqual(savedSettings.theme, 'dark');
    assert.strictEqual(savedSettings.pomodoro.focus, 30);

    // 9. Delete task
    const deletedTask = await cloudRepo.deleteTask(task.id);
    assert.strictEqual(deletedTask, true);
    const tasksAfter = await cloudRepo.getTasks();
    assert.strictEqual(tasksAfter.length, 0);
  });

  // --------------------------------------------------------------------------
  // Test 9: RepositoryFactory mode management
  // --------------------------------------------------------------------------
  await runTest('9. RepositoryFactory manages local and cloud modes and switches on auth', async () => {
    const env = setupTestEnvironment();
    const { RepositoryFactory, LocalRepository, CloudRepository } = env.StudyFlowRepository;

    RepositoryFactory.reset();
    assert.strictEqual(RepositoryFactory.getMode(), 'local');
    assert.ok(RepositoryFactory.getActive() instanceof LocalRepository);

    // Set cloud mode
    RepositoryFactory.setMode('cloud', 'user-xyz');
    assert.strictEqual(RepositoryFactory.getMode(), 'cloud');
    assert.strictEqual(RepositoryFactory.getActiveUserId(), 'user-xyz');
    assert.ok(RepositoryFactory.getActive() instanceof CloudRepository);

    // Reset to local
    RepositoryFactory.setMode('local');
    assert.strictEqual(RepositoryFactory.getMode(), 'local');
    assert.ok(RepositoryFactory.getActive() instanceof LocalRepository);
  });

  // --------------------------------------------------------------------------
  // Test 10: Store active key isolation in cloud mode
  // --------------------------------------------------------------------------
  await runTest('10. Store routes reads/writes to cloud cache key in cloud mode and leaves local intact', () => {
    const env = setupTestEnvironment();
    const { RepositoryFactory } = env.StudyFlowRepository;

    // Seed local tasks
    const initialLocalTasks = env.Store.getTasks();
    assert.ok(initialLocalTasks.length > 0);

    // Switch to cloud mode for user-42
    RepositoryFactory.setMode('cloud', 'user-42');

    // In cloud mode, cloud tasks start empty if not hydrated
    const cloudTasksInitial = env.Store.getTasks();
    assert.strictEqual(cloudTasksInitial.length, 0, 'Cloud tasks key is isolated');

    // Save a cloud task
    env.Store.saveTask({ title: 'Cloud-Only Task' });
    const cloudTasksAfter = env.Store.getTasks();
    assert.strictEqual(cloudTasksAfter.length, 1);
    assert.strictEqual(cloudTasksAfter[0].title, 'Cloud-Only Task');

    // Switch back to local mode
    RepositoryFactory.setMode('local');
    const localTasksAfter = env.Store.getTasks();
    assert.strictEqual(localTasksAfter.length, initialLocalTasks.length, 'Local tasks are 100% preserved');
    assert.ok(localTasksAfter.every(t => t.title !== 'Cloud-Only Task'), 'Cloud task never leaked into local key');
  });

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log('\n========================================');
  console.log(`Test Results: ${passedCount} passed, ${failedCount} failed`);
  console.log('========================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
})();
