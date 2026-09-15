/**
 * tests/phase-f-security-and-resilience.test.js
 * Comprehensive automated verification for StudyFlow v2.0 Phase F:
 * - Security & XSS protection
 * - Corrupted local state resilience (Store, Cloud Cache, SyncQueue, Migration)
 * - Performance stress testing with realistic large dataset
 * - Backup export / restore data recovery
 * - Cross-user cache isolation
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

let passedCount = 0;
let failedCount = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    failedCount++;
  }
}

// In-memory localStorage mock
class MockLocalStorage {
  constructor() {
    this._store = new Map();
  }
  getItem(key) {
    return this._store.has(key) ? this._store.get(key) : null;
  }
  setItem(key, value) {
    this._store.set(key, String(value));
  }
  removeItem(key) {
    this._store.delete(key);
  }
  clear() {
    this._store.clear();
  }
  key(index) {
    return Array.from(this._store.keys())[index] || null;
  }
  get length() {
    return this._store.size;
  }
}

// Helper to construct fully wired VM context
function createTestEnvironment(customStorage = new MockLocalStorage()) {
  const context = {
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    crypto: {
      randomUUID: () => '00000000-0000-4000-8000-' + Math.random().toString(16).substring(2, 14).padStart(12, '0')
    },
    navigator: { onLine: true },
    localStorage: customStorage,
    window: {},
    globalThis: {},
    document: {
      documentElement: {
        setAttribute: () => {},
        getAttribute: () => 'light',
        classList: { add: () => {}, remove: () => {} }
      },
      body: { dataset: { page: 'dashboard' } },
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
      hidden: false
    },
    CustomEvent: class CustomEvent {
      constructor(type, detail) {
        this.type = type;
        this.detail = detail;
      }
    },
    matchMedia: () => ({ matches: false, addEventListener: () => {} })
  };

  context.window = context;
  context.globalThis = context;
  context.window.localStorage = customStorage;
  context.window.addEventListener = (event, cb) => {};
  context.window.removeEventListener = (event, cb) => {};

  vm.createContext(context);

  // Load scripts in canonical order with exports assigned to globalThis
  const scriptConfigs = [
    { file: '../js/supabase-config.js', exportSuffix: '' },
    { file: '../js/supabase.js', exportSuffix: '\n;globalThis.StudyFlowSupabase = StudyFlowSupabase;' },
    { file: '../js/auth.js', exportSuffix: '\n;globalThis.Auth = Auth;' },
    { file: '../js/storage.js', exportSuffix: '\n;globalThis.Store = Store; globalThis.Dates = Dates;' },
    { file: '../js/repository.js', exportSuffix: '\n;globalThis.StudyFlowRepository = StudyFlowRepository;' },
    { file: '../js/migration.js', exportSuffix: '\n;globalThis.StudyFlowMigration = StudyFlowMigration;' },
    { file: '../js/realtime.js', exportSuffix: '\n;globalThis.StudyFlowRealtime = StudyFlowRealtime;' },
    { file: '../js/sync-queue.js', exportSuffix: '\n;globalThis.StudyFlowSyncQueue = StudyFlowSyncQueue;' },
    { file: '../js/app.js', exportSuffix: '\n;globalThis.App = App;' }
  ];

  for (const cfg of scriptConfigs) {
    const code = fs.readFileSync(path.resolve(__dirname, cfg.file), 'utf8') + cfg.exportSuffix;
    vm.runInContext(code, context);
  }

  return context;
}

(async function () {
  console.log('Running StudyFlow v2.0 Phase F Security, Reliability & Resilience Test Suite...\n');

  // ==========================================================================
  // 1. SECURITY & XSS TESTS
  // ==========================================================================
  await runTest('1. App.escapeHtml strictly escapes HTML entities and quotes', () => {
    const env = createTestEnvironment();
    const malicious = '<script>alert("XSS")</script>&\'"';
    const escaped = env.App.escapeHtml(malicious);
    assert.strictEqual(escaped, '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;&amp;&#39;&quot;');
  });

  await runTest('2. Store._safeColor rejects CSS injection, scripts, and malformed colors', () => {
    const env = createTestEnvironment();
    const Store = env.Store;
    assert.strictEqual(Store._safeColor('#7c3aed'), '#7c3aed');
    assert.strictEqual(Store._safeColor('#fff'), '#fff');
    assert.strictEqual(Store._safeColor('red; background: url(xss)'), '#7c3aed');
    assert.strictEqual(Store._safeColor('"><script>alert(1)</script>'), '#7c3aed');
    assert.strictEqual(Store._safeColor(null), '#7c3aed');
    assert.strictEqual(Store._safeColor(undefined), '#7c3aed');
    assert.strictEqual(Store._safeColor({}), '#7c3aed');
  });

  await runTest('3. Auth.sanitizeRedirect blocks open redirects, protocols, and directory escapes', () => {
    const env = createTestEnvironment();
    const Auth = env.Auth;
    assert.strictEqual(Auth.sanitizeRedirect('https://evil.com'), 'index.html');
    assert.strictEqual(Auth.sanitizeRedirect('//evil.com'), 'index.html');
    assert.strictEqual(Auth.sanitizeRedirect('javascript:alert(1)'), 'index.html');
    assert.strictEqual(Auth.sanitizeRedirect('data:text/html,<script>alert(1)</script>'), 'index.html');
    assert.strictEqual(Auth.sanitizeRedirect('/etc/passwd'), 'index.html');
    assert.strictEqual(Auth.sanitizeRedirect('tasks.html'), 'tasks.html');
    assert.strictEqual(Auth.sanitizeRedirect('pages/subjects.html'), 'pages/subjects.html');
    assert.strictEqual(Auth.sanitizeRedirect('../index.html'), '../index.html');
  });

  // ==========================================================================
  // 2. CORRUPTED LOCAL STATE RESILIENCE
  // ==========================================================================
  await runTest('4. Store handles corrupt / malformed JSON in local storage keys gracefully', () => {
    const storage = new MockLocalStorage();
    // Inject corrupt JSON into multiple store keys
    storage.setItem('sp_tasks', '{{{INVALID_JSON_CORRUPT');
    storage.setItem('sp_subjects', 'not a json at all');
    storage.setItem('sp_notes', '{"bad": "object instead of array"}');
    storage.setItem('sp_habits', 'null');
    storage.setItem('sp_habit_completions', '["valid", 123, null]');
    storage.setItem('sp_settings', '{corrupt json settings');

    const env = createTestEnvironment(storage);
    const Store = env.Store;

    // Should return safe defaults without throwing exceptions
    const tasks = Store.getTasks();
    assert(Array.isArray(tasks), 'Tasks should return an array');
    assert.strictEqual(tasks.length, 0);

    const subjects = Store.getSubjects();
    assert(Array.isArray(subjects), 'Subjects should return an array');
    assert.strictEqual(subjects.length, 0);

    const notes = Store.getNotes();
    assert(Array.isArray(notes), 'Notes should return an array');
    assert.strictEqual(notes.length, 0);

    const habits = Store.getHabits(true);
    assert(Array.isArray(habits), 'Habits should return an array');
    assert.strictEqual(habits.length, 0);

    const completions = Store.getHabitCompletions();
    assert(Array.isArray(completions), 'Completions should return an array');

    const settings = Store.getSettings();
    assert(settings && typeof settings === 'object', 'Settings should return default object');
    assert.strictEqual(settings.theme, 'system');
  });

  await runTest('5. Store handles corrupt cloud cache JSON gracefully in Cloud Mode', () => {
    const storage = new MockLocalStorage();
    const userId = '00000000-0000-4000-8000-000000000123';
    storage.setItem(`sp_cloud_sp_tasks_${userId}`, '{{bad json');
    storage.setItem(`sp_cloud_sp_subjects_${userId}`, '[null, {"invalid": true}]');

    const env = createTestEnvironment(storage);
    const { RepositoryFactory, CloudRepository } = env.StudyFlowRepository;
    const Store = env.Store;

    const mockClient = {
      auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
      from: () => ({ select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) })
    };

    RepositoryFactory.setMode('cloud', userId, new CloudRepository(mockClient));
    assert.strictEqual(RepositoryFactory.getMode(), 'cloud');

    // Read should fall back cleanly
    const tasks = Store.getTasks();
    assert(Array.isArray(tasks));
    assert.strictEqual(tasks.length, 0);

    // Subject normalizing should repair incomplete row
    const subjects = Store.getSubjects();
    assert(Array.isArray(subjects));
    assert.strictEqual(subjects.length, 1);
    assert.strictEqual(subjects[0].name, 'Untitled subject');
  });

  await runTest('6. SyncQueue recovers gracefully from corrupted queue storage JSON', async () => {
    const storage = new MockLocalStorage();
    const userId = '00000000-0000-4000-8000-000000000456';
    storage.setItem(`sp_sync_queue_${userId}`, '{corrupted-queue-payload}');

    const env = createTestEnvironment(storage);
    const SyncQueue = env.StudyFlowSyncQueue;

    SyncQueue.init({ userId, repository: { saveTask: async () => {} } });

    // Should read as empty array rather than crashing
    assert.strictEqual(SyncQueue.getPending().length, 0);
    assert.strictEqual(SyncQueue.getStatus().status, 'idle');

    // Enqueueing a new item should repair the queue
    const item = SyncQueue.enqueue({
      action: 'saveTask',
      table: 'tasks',
      recordId: 'task-new-1',
      payload: { title: 'Repaired task' }
    });

    assert(item && item.id);
    assert.strictEqual(SyncQueue.getPending().length, 1);
    SyncQueue.destroy();
  });

  await runTest('7. Migration service handles corrupted migration state map safely', async () => {
    const storage = new MockLocalStorage();
    const userId = '00000000-0000-4000-8000-000000000789';
    storage.setItem(`sp_migration_map_${userId}`, 'invalid JSON mapping');
    storage.setItem(`sp_migration_state_${userId}`, 'invalid JSON state');

    const env = createTestEnvironment(storage);
    const Migration = env.StudyFlowMigration;

    // Should read without crash
    const state = Migration.getStatus(userId);
    assert.strictEqual(state.migrated, false);

    const map = Migration._getIdMap(userId);
    assert(map && typeof map === 'object');
    assert.deepStrictEqual(Object.keys(map).sort(), ['habits', 'notes', 'sessions', 'subjects', 'tasks']);
    assert.strictEqual(Object.keys(map.subjects).length, 0);
  });

  // ==========================================================================
  // 3. CROSS-USER CACHE ISOLATION
  // ==========================================================================
  await runTest('8. Account switching completely isolates cloud cache and queues', () => {
    const storage = new MockLocalStorage();
    const env = createTestEnvironment(storage);
    const { RepositoryFactory, CloudRepository } = env.StudyFlowRepository;
    const Store = env.Store;
    const SyncQueue = env.StudyFlowSyncQueue;

    const userA = '00000000-0000-4000-8000-000000000111';
    const userB = '00000000-0000-4000-8000-000000000222';

    const dummyRepo = {
      saveTask: async () => {},
      saveSubject: async () => {}
    };

    const initialLocalTasks = storage.getItem('sp_tasks');

    // Alice logs in and saves a task in Cloud Mode
    RepositoryFactory.setMode('cloud', userA, new CloudRepository({}));
    SyncQueue.init({ userId: userA, repository: dummyRepo });

    Store.saveTask({ id: 'task-a-1', title: 'Alice Task 1', subjectId: '' });
    Store.saveSubject({ id: 'subj-a-1', name: 'Alice Math' });
    SyncQueue.enqueue({ action: 'saveTask', table: 'tasks', recordId: 'task-a-1', payload: {} });

    assert.strictEqual(Store.getTasks().length, 1);
    assert.strictEqual(Store.getTasks()[0].title, 'Alice Task 1');
    assert.strictEqual(SyncQueue.getPending().length, 1);

    // Switch to Bob
    SyncQueue.destroy();
    RepositoryFactory.setMode('cloud', userB, new CloudRepository({}));
    SyncQueue.init({ userId: userB, repository: dummyRepo });

    // Bob should see ZERO tasks, ZERO subjects, and ZERO queue items
    assert.strictEqual(Store.getTasks().length, 0);
    assert.strictEqual(Store.getSubjects().length, 0);
    assert.strictEqual(SyncQueue.getPending().length, 0);

    // Bob saves his own data
    Store.saveTask({ id: 'task-b-1', title: 'Bob Physics Task', subjectId: '' });
    assert.strictEqual(Store.getTasks().length, 1);
    assert.strictEqual(Store.getTasks()[0].title, 'Bob Physics Task');

    // Switch back to Alice
    SyncQueue.destroy();
    RepositoryFactory.setMode('cloud', userA, new CloudRepository({}));
    SyncQueue.init({ userId: userA, repository: dummyRepo });

    // Alice\'s data and queue must be restored exactly
    assert.strictEqual(Store.getTasks().length, 1);
    assert.strictEqual(Store.getTasks()[0].title, 'Alice Task 1');
    assert.strictEqual(Store.getSubjects().length, 1);
    assert.strictEqual(Store.getSubjects()[0].name, 'Alice Math');
    assert.strictEqual(SyncQueue.getPending().length, 1);

    // Verify local backup keys (sp_*) remain completely untouched
    assert.strictEqual(storage.getItem('sp_tasks'), initialLocalTasks);

    SyncQueue.destroy();
  });

  // ==========================================================================
  // 4. DATA RECOVERY (v1.5 JSON BACKUP EXPORT & IMPORT)
  // ==========================================================================
  await runTest('9. Local data backup export and import preserves all entities, completions & settings', () => {
    const storage = new MockLocalStorage();
    const env = createTestEnvironment(storage);
    const Store = env.Store;

    // Clear initial seed
    Store.clearAll();

    // Seed test local data
    Store.saveSubject({ id: 's1', name: 'Mathematics', color: '#8b5cf6' });
    Store.saveTask({ id: 't1', title: 'Complete Problem Set 1', subjectId: 's1', priority: 'high', estimate: 60 });
    Store.saveNote({ id: 'n1', title: 'Calculus Theorems', content: 'Derivative rules...', subjectId: 's1', pinned: true });
    Store.saveHabit({ id: 'h1', name: 'Daily Review', frequency: 'daily', color: '#10b981' });
    Store.setHabitCompletion('h1', '2026-09-15', true);
    Store.saveSession({ id: 'sess1', subjectId: 's1', durationMinutes: 45, notes: 'Focus session on Limits' });
    Store.saveSettings({ theme: 'dark', pomodoro: { focus: 30, dailyGoal: 180 } });

    // Export backup JSON
    const exportedString = Store.exportJSON();
    assert(typeof exportedString === 'string' && exportedString.length > 50);

    // Clear store completely
    Store.clearAll();
    assert.strictEqual(Store.getSubjects().length, 0);
    assert.strictEqual(Store.getTasks().length, 0);
    assert.strictEqual(Store.getNotes().length, 0);
    assert.strictEqual(Store.getHabits(true).length, 0);
    assert.strictEqual(Store.getHabitCompletions().length, 0);
    assert.strictEqual(Store.getSessions().length, 0);

    // Import backup via Store.importJSON
    const importRes = Store.importJSON(exportedString);
    assert.strictEqual(importRes.success, true);

    // Verify all records and relationships are intact
    const restoredSubjects = Store.getSubjects();
    assert.strictEqual(restoredSubjects.length, 1);
    assert.strictEqual(restoredSubjects[0].name, 'Mathematics');

    const restoredTasks = Store.getTasks();
    assert.strictEqual(restoredTasks.length, 1);
    assert.strictEqual(restoredTasks[0].title, 'Complete Problem Set 1');
    assert.strictEqual(restoredTasks[0].subjectId, 's1');

    const restoredNotes = Store.getNotes();
    assert.strictEqual(restoredNotes.length, 1);
    assert.strictEqual(restoredNotes[0].pinned, true);

    const restoredHabits = Store.getHabits(true);
    assert.strictEqual(restoredHabits.length, 1);
    assert.strictEqual(restoredHabits[0].name, 'Daily Review');

    const restoredCompletions = Store.getHabitCompletions('h1');
    assert.strictEqual(restoredCompletions.length, 1);
    assert.strictEqual(restoredCompletions[0].date, '2026-09-15');

    const restoredSessions = Store.getSessions();
    assert.strictEqual(restoredSessions.length, 1);
    assert.strictEqual(restoredSessions[0].durationMinutes, 45);

    const restoredSettings = Store.getSettings();
    assert.strictEqual(restoredSettings.theme, 'dark');
    assert.strictEqual(restoredSettings.pomodoro.focus, 30);
  });

  // ==========================================================================
  // 5. PERFORMANCE & STRESS TESTING
  // ==========================================================================
  await runTest('10. Performance stress test with realistic large dataset executes cleanly within <100ms', () => {
    const storage = new MockLocalStorage();
    const env = createTestEnvironment(storage);
    const Store = env.Store;

    // Clear initial seed
    Store.clearAll();

    const startPopulate = Date.now();

    // 20 subjects
    for (let i = 1; i <= 20; i++) {
      Store.saveSubject({ id: `subj_${i}`, name: `Subject ${i}`, color: '#7c3aed' });
    }

    // 100 tasks
    for (let i = 1; i <= 100; i++) {
      Store.saveTask({
        id: `task_${i}`,
        title: `Academic Assignment ${i}`,
        subjectId: `subj_${(i % 20) + 1}`,
        dueDate: '2026-09-20',
        priority: i % 3 === 0 ? 'high' : (i % 2 === 0 ? 'medium' : 'low'),
        estimate: 45,
        category: 'Assignment'
      });
    }

    // 100 notes
    for (let i = 1; i <= 100; i++) {
      Store.saveNote({
        id: `note_${i}`,
        title: `Lecture Note ${i}`,
        content: `Comprehensive study notes regarding chapter ${i}...`,
        subjectId: `subj_${(i % 20) + 1}`,
        pinned: i <= 5
      });
    }

    // 50 habits
    for (let i = 1; i <= 50; i++) {
      Store.saveHabit({
        id: `habit_${i}`,
        name: `Habit Habitual Routine ${i}`,
        frequency: 'daily',
        color: '#10b981'
      });
    }

    // 500 habit completions
    for (let h = 1; h <= 50; h++) {
      for (let d = 1; d <= 10; d++) {
        const dayStr = d < 10 ? `0${d}` : `${d}`;
        Store.setHabitCompletion(`habit_${h}`, `2026-09-${dayStr}`, true);
      }
    }

    // 200 study sessions
    for (let s = 1; s <= 200; s++) {
      Store.saveSession({
        id: `session_${s}`,
        subjectId: `subj_${(s % 20) + 1}`,
        durationMinutes: 25,
        type: 'focus',
        notes: `Pomodoro round ${s}`
      });
    }

    const populateDuration = Date.now() - startPopulate;

    // Measure retrieval performance across all datasets
    const startRead = Date.now();
    const allTasks = Store.getTasks();
    const allSubjects = Store.getSubjects();
    const allNotes = Store.getNotes();
    const allHabits = Store.getHabits(true);
    const allCompletions = Store.getHabitCompletions();
    const allSessions = Store.getSessions();
    const readDuration = Date.now() - startRead;

    assert.strictEqual(allTasks.length, 100);
    assert.strictEqual(allSubjects.length, 20);
    assert.strictEqual(allNotes.length, 100);
    assert.strictEqual(allHabits.length, 50);
    assert.strictEqual(allCompletions.length, 500);
    assert.strictEqual(allSessions.length, 200);

    console.log(`    (Populate: ${populateDuration}ms, Full Read of 970 entities: ${readDuration}ms)`);
    assert(readDuration < 100, `Reading large dataset should take <100ms (took ${readDuration}ms)`);
  });

  console.log(`\n========================================`);
  console.log(`Phase F Security & Resilience Results: ${passedCount} passed, ${failedCount} failed`);
  console.log(`========================================\n`);

  if (failedCount > 0) {
    process.exit(1);
  }
})();
