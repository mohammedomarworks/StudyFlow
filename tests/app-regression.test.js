/**
 * tests/app-regression.test.js
 * Regression verification ensuring StudyFlow v1.5.0 local behavior is 100% intact.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

let passedCount = 0;
let failedCount = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    failedCount++;
  }
}

console.log('Running v1.5.0 Application Regression Test Suite...\n');

// ----------------------------------------------------------------------------
// Test 1: Verify all 10 HTML files exist and all script references resolve
// ----------------------------------------------------------------------------
runTest('1. All HTML pages exist and script src paths resolve to physical files', () => {
  const rootDir = path.resolve(__dirname, '..');
  const htmlFiles = [
    'index.html',
    'pages/tasks.html',
    'pages/subjects.html',
    'pages/calendar.html',
    'pages/timer.html',
    'pages/progress.html',
    'pages/notes.html',
    'pages/settings.html',
    'pages/about.html',
    'pages/habits.html',
    'pages/auth.html',
    'supabase-test.html'
  ];

  for (const relHtml of htmlFiles) {
    const fullHtmlPath = path.join(rootDir, relHtml);
    assert.ok(fs.existsSync(fullHtmlPath), `File ${relHtml} must exist`);
    const content = fs.readFileSync(fullHtmlPath, 'utf8');

    // Extract all <script src="...">
    const scriptSrcMatches = content.matchAll(/<script\s+[^>]*src=["']([^"']+)["']/gi);
    for (const match of scriptSrcMatches) {
      const src = match[1];
      if (src.startsWith('http://') || src.startsWith('https://')) {
        continue; // CDN or external
      }
      const dir = path.dirname(fullHtmlPath);
      const targetPath = path.resolve(dir, src);
      assert.ok(
        fs.existsSync(targetPath),
        `In ${relHtml}, script src "${src}" must resolve to existing file at ${targetPath}`
      );
    }
  }
});

// ----------------------------------------------------------------------------
// Test 2: In-memory Store full suite (Dashboard, Tasks, Subjects, Calendar, Notes, Timer, Habits, Settings)
// ----------------------------------------------------------------------------
runTest('2. Store CRUD operations work 100% locally across all modules', () => {
  const storage = {};
  const mockLocalStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
    clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
  };

  global.localStorage = mockLocalStorage;
  global.window = global;

  const storageCode = fs.readFileSync(path.resolve(__dirname, '../js/storage.js'), 'utf8');
  vm.runInThisContext(storageCode);

  assert.ok(typeof Store !== 'undefined', 'Store global must exist');
  assert.ok(typeof Dates !== 'undefined', 'Dates global must exist');

  // Seed default data
  Store.seedIfEmpty();

  // Dashboard / Stats
  const stats = Store.getStats();
  assert.ok(stats.total > 0, 'Stats calculates total tasks');
  assert.ok(stats.subjects > 0, 'Stats calculates subjects');

  // Subject Progress
  const subjectProg = Store.getSubjectProgress();
  assert.ok(Array.isArray(subjectProg), 'Subject progress returns array');

  // Tasks CRUD
  const initialTaskCount = Store.getTasks().length;
  const newTask = Store.saveTask({
    title: 'Unit Test Task',
    priority: 'high',
    estimate: 30
  });
  assert.strictEqual(Store.getTasks().length, initialTaskCount + 1);
  const toggled = Store.toggleTask(newTask.id);
  assert.strictEqual(toggled, true);
  Store.deleteTask(newTask.id);
  assert.strictEqual(Store.getTasks().length, initialTaskCount);

  // Subjects CRUD
  const initialSubjCount = Store.getSubjects().length;
  const newSubj = Store.saveSubject({
    name: 'Astronomy',
    color: '#3b82f6'
  });
  assert.strictEqual(Store.getSubjects().length, initialSubjCount + 1);
  Store.deleteSubject(newSubj.id);
  assert.strictEqual(Store.getSubjects().length, initialSubjCount);

  // Notes CRUD
  const initialNotesCount = Store.getNotes().length;
  const newNote = Store.saveNote({
    title: 'Cosmology Notes',
    content: 'Notes body'
  });
  assert.strictEqual(Store.getNotes().length, initialNotesCount + 1);
  Store.togglePinNote(newNote.id);
  assert.strictEqual(Store.getNote(newNote.id).pinned, true);
  Store.deleteNote(newNote.id);
  assert.strictEqual(Store.getNotes().length, initialNotesCount);

  // Timer / Sessions
  const initialSessions = Store.getSessions().length;
  Store.saveSession({
    durationMinutes: 25,
    type: 'focus',
    notes: 'Test session'
  });
  assert.strictEqual(Store.getSessions().length, initialSessions + 1);

  // Habits CRUD
  const initialHabits = Store.getHabits(true).length;
  const newHabit = Store.saveHabit({
    name: 'Evening Reading',
    frequency: 'daily'
  });
  assert.strictEqual(Store.getHabits(true).length, initialHabits + 1);
  Store.toggleHabitCompletion(newHabit.id, Dates.todayISO());
  assert.strictEqual(Store.isHabitCompletedOnDate(newHabit.id, Dates.todayISO()), true);
  Store.deleteHabit(newHabit.id);
  assert.strictEqual(Store.getHabits(true).length, initialHabits);

  // Settings & Export
  const settings = Store.getSettings();
  assert.strictEqual(settings.theme, 'system');
  Store.saveSettings({ theme: 'dark' });
  assert.strictEqual(Store.getSettings().theme, 'dark');

  const jsonExport = Store.exportJSON();
  const validation = Store.validateBackup(jsonExport);
  assert.strictEqual(validation.valid, true);
});

// ----------------------------------------------------------------------------
// Test 3: Unconfigured Supabase runs gracefully without throwing
// ----------------------------------------------------------------------------
runTest('3. Unconfigured Supabase client fails gracefully with zero impact on host app', () => {
  const StudyFlowSupabase = require('../js/supabase.js');
  StudyFlowSupabase.reset();

  assert.strictEqual(StudyFlowSupabase.isConfigured(), false);
  const client = StudyFlowSupabase.getClient();
  assert.strictEqual(client, null);

  const diag = StudyFlowSupabase.getDiagnostics();
  assert.strictEqual(diag.configured, false);
  assert.strictEqual(diag.clientActive, false);
});

console.log(`\n========================================`);
console.log(`Test Results: ${passedCount} passed, ${failedCount} failed`);
console.log(`========================================\n`);

if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
