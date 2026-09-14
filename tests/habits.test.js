/**
 * tests/habits.test.js
 * Test suite for Phase 9: Habit Tracker in StudyFlow.
 * Covers scenarios A through K.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// 1. Mock browser localStorage & window globals
const storage = {};
const mockLocalStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: (k) => { delete storage[k]; },
  clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
};

global.localStorage = mockLocalStorage;
global.window = global;

// 2. Load and evaluate js/storage.js
const storagePath = path.resolve(__dirname, '../js/storage.js');
const storageCode = fs.readFileSync(storagePath, 'utf8');
vm.runInThisContext(storageCode);

// Helper to reset storage cleanly between tests
function resetStorageClean() {
  mockLocalStorage.clear();
  mockLocalStorage.setItem(Store.KEYS.seeded, '1');
}

let passedCount = 0;
let failedCount = 0;

function runTest(name, fn) {
  try {
    resetStorageClean();
    fn();
    console.log(`  ✓ ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    failedCount++;
  }
}

console.log('Running Habit Tracker Test Suite (Scenarios A - K)...\n');

// ----------------------------------------------------------------------------
// Test A: Daily streak: Habit completed 3 consecutive days -> current streak = 3
// ----------------------------------------------------------------------------
runTest('A. Daily streak: 3 consecutive days completed yields currentStreak = 3', () => {
  const originalTodayISO = Dates.todayISO;
  try {
    // Simulate today = 2026-09-16 (Wednesday)
    Dates.todayISO = () => '2026-09-16';

    const habit = Store.saveHabit({
      name: 'Daily Reading',
      frequency: 'daily',
      targetDays: [0, 1, 2, 3, 4, 5, 6]
    });

    // Complete Mon (14th), Tue (15th), Wed (16th)
    Store.toggleHabitCompletion(habit.id, '2026-09-14');
    Store.toggleHabitCompletion(habit.id, '2026-09-15');
    Store.toggleHabitCompletion(habit.id, '2026-09-16');

    const streak = Store.getHabitStreak(habit.id);
    assert.strictEqual(streak.currentStreak, 3, `Expected currentStreak 3, got ${streak.currentStreak}`);
    assert.strictEqual(streak.bestStreak, 3, `Expected bestStreak 3, got ${streak.bestStreak}`);
  } finally {
    Dates.todayISO = originalTodayISO;
  }
});

// ----------------------------------------------------------------------------
// Test B: Daily streak break: Mon, Tue done, Wed missed, Thu done -> current streak = 1
// ----------------------------------------------------------------------------
runTest('B. Daily streak break: Mon/Tue done, Wed missed, Thu done yields currentStreak = 1', () => {
  const originalTodayISO = Dates.todayISO;
  try {
    // Simulate today = 2026-09-17 (Thursday)
    Dates.todayISO = () => '2026-09-17';

    const habit = Store.saveHabit({
      name: 'Daily Flashcards',
      frequency: 'daily',
      targetDays: [0, 1, 2, 3, 4, 5, 6]
    });

    // Complete Mon (14th), Tue (15th), miss Wed (16th), complete Thu (17th)
    Store.toggleHabitCompletion(habit.id, '2026-09-14');
    Store.toggleHabitCompletion(habit.id, '2026-09-15');
    // 2026-09-16 is skipped
    Store.toggleHabitCompletion(habit.id, '2026-09-17');

    const streak = Store.getHabitStreak(habit.id);
    assert.strictEqual(streak.currentStreak, 1, `Expected currentStreak 1, got ${streak.currentStreak}`);
    assert.strictEqual(streak.bestStreak, 2, `Expected bestStreak 2 (Mon+Tue), got ${streak.bestStreak}`);
  } finally {
    Dates.todayISO = originalTodayISO;
  }
});

// ----------------------------------------------------------------------------
// Test C: Weekday streak: Mon/Wed/Fri scheduled, completed Mon, Wed, Fri -> current streak = 3
// (Tue/Thu not scheduled, should NOT break streak)
// ----------------------------------------------------------------------------
runTest('C. Weekday streak: Mon/Wed/Fri completed yields streak = 3 (Tue/Thu non-scheduled do not break)', () => {
  const originalTodayISO = Dates.todayISO;
  try {
    // Simulate today = 2026-09-18 (Friday, day 5)
    Dates.todayISO = () => '2026-09-18';

    const habit = Store.saveHabit({
      name: 'MWF Lab Prep',
      frequency: 'weekdays',
      targetDays: [1, 3, 5] // Mon, Wed, Fri
    });

    // Complete Mon (14th), Wed (16th), Fri (18th)
    Store.toggleHabitCompletion(habit.id, '2026-09-14');
    Store.toggleHabitCompletion(habit.id, '2026-09-16');
    Store.toggleHabitCompletion(habit.id, '2026-09-18');

    const streak = Store.getHabitStreak(habit.id);
    assert.strictEqual(streak.currentStreak, 3, `Expected currentStreak 3, got ${streak.currentStreak}`);
    assert.strictEqual(streak.bestStreak, 3, `Expected bestStreak 3, got ${streak.bestStreak}`);
  } finally {
    Dates.todayISO = originalTodayISO;
  }
});

// ----------------------------------------------------------------------------
// Test D: Weekday missing occurrence: Mon completed, Wed missed, Fri completed -> current streak = 1
// ----------------------------------------------------------------------------
runTest('D. Weekday missing occurrence: Mon done, Wed missed, Fri done yields currentStreak = 1', () => {
  const originalTodayISO = Dates.todayISO;
  try {
    // Simulate today = 2026-09-18 (Friday, day 5)
    Dates.todayISO = () => '2026-09-18';

    const habit = Store.saveHabit({
      name: 'MWF Coding',
      frequency: 'weekdays',
      targetDays: [1, 3, 5] // Mon, Wed, Fri
    });

    // Complete Mon (14th), miss Wed (16th), complete Fri (18th)
    Store.toggleHabitCompletion(habit.id, '2026-09-14');
    // 2026-09-16 was scheduled and missed
    Store.toggleHabitCompletion(habit.id, '2026-09-18');

    const streak = Store.getHabitStreak(habit.id);
    assert.strictEqual(streak.currentStreak, 1, `Expected currentStreak 1, got ${streak.currentStreak}`);
    assert.strictEqual(streak.bestStreak, 1, `Expected bestStreak 1, got ${streak.bestStreak}`);
  } finally {
    Dates.todayISO = originalTodayISO;
  }
});

// ----------------------------------------------------------------------------
// Test E: Duplicate completion prevention: Calling toggle or set twice produces only 1 record
// ----------------------------------------------------------------------------
runTest('E. Duplicate completion prevention: Same habit and date produces only 1 record', () => {
  const originalTodayISO = Dates.todayISO;
  try {
    Dates.todayISO = () => '2026-09-16';

    const habit = Store.saveHabit({ name: 'No Dupes Habit', frequency: 'daily' });

    // Calling setHabitCompletion twice
    Store.setHabitCompletion(habit.id, '2026-09-15', true);
    Store.setHabitCompletion(habit.id, '2026-09-15', true);

    const completions = Store.getHabitCompletions(habit.id).filter(c => c.date === '2026-09-15');
    assert.strictEqual(completions.length, 1, `Expected 1 completion record, got ${completions.length}`);

    // If duplicate raw records were injected directly into storage
    const raw = [
      { id: 'c1', habitId: habit.id, date: '2026-09-14' },
      { id: 'c2', habitId: habit.id, date: '2026-09-14' }
    ];
    mockLocalStorage.setItem(Store.KEYS.habitCompletions, JSON.stringify(raw));

    const normalized = Store.getHabitCompletions(habit.id);
    assert.strictEqual(normalized.length, 1, 'Store.getHabitCompletions deduplicates identical habitId + date entries');
  } finally {
    Dates.todayISO = originalTodayISO;
  }
});

// ----------------------------------------------------------------------------
// Test F: Archive integrity: Archiving preserves completions, restoring keeps full history
// ----------------------------------------------------------------------------
runTest('F. Archive integrity: Archiving preserves completion records, unarchiving restores them', () => {
  const originalTodayISO = Dates.todayISO;
  try {
    Dates.todayISO = () => '2026-09-16';

    const habit = Store.saveHabit({ name: 'Exam Cramming', frequency: 'daily' });
    Store.toggleHabitCompletion(habit.id, '2026-09-14');
    Store.toggleHabitCompletion(habit.id, '2026-09-15');

    // Verify active habits include it
    assert.strictEqual(Store.getHabits(false).length, 1);
    assert.strictEqual(Store.getHabitCompletions(habit.id).length, 2);

    // Archive habit
    Store.archiveHabit(habit.id);

    // Active list should be empty
    assert.strictEqual(Store.getHabits(false).length, 0, 'Archived habit excluded from active list');
    // Full list includes it
    assert.strictEqual(Store.getHabits(true).length, 1, 'Full list includes archived habit');
    // Completions remain in storage
    assert.strictEqual(Store.getHabitCompletions(habit.id).length, 2, 'Completions preserved after archiving');

    // Restore habit
    Store.restoreHabit(habit.id);
    assert.strictEqual(Store.getHabits(false).length, 1, 'Restored habit returned to active list');
    assert.strictEqual(Store.getHabitCompletions(habit.id).length, 2, 'Restored habit retains all completions');
  } finally {
    Dates.todayISO = originalTodayISO;
  }
});

// ----------------------------------------------------------------------------
// Test G: Import validation: Valid backup imports cleanly, malformed payload rejected safely
// ----------------------------------------------------------------------------
runTest('G. Import validation: Valid backup restores cleanly, malformed payload rejected', () => {
  const validHabit = {
    id: 'h-import-1',
    name: 'Imported Routine',
    frequency: 'daily',
    targetDays: [0, 1, 2, 3, 4, 5, 6],
    icon: '📚',
    color: '#7c3aed',
    archived: false,
    createdAt: new Date().toISOString()
  };
  const validCompletion = {
    id: 'c-import-1',
    habitId: 'h-import-1',
    date: '2026-09-10',
    completedAt: new Date().toISOString()
  };

  const validPayload = {
    version: '2.0.0',
    exportedAt: new Date().toISOString(),
    subjects: [],
    tasks: [],
    habits: [validHabit],
    habitCompletions: [validCompletion],
    notes: [],
    sessions: [],
    activity: [],
    settings: {}
  };

  // 1. Valid validation
  const v1 = Store.validateBackup(JSON.stringify(validPayload));
  assert.strictEqual(v1.valid, true, 'Valid payload passes validation');
  assert.strictEqual(v1.counts.habits, 1, 'Detected 1 habit in backup');
  assert.strictEqual(v1.counts.habitCompletions, 1, 'Detected 1 habit completion in backup');

  const applyRes = Store.applyBackup(v1.normalizedData);
  assert.strictEqual(applyRes.success, true, 'Backup applied successfully');
  assert.strictEqual(Store.getHabits().length, 1, 'Habit restored in Store');

  // 2. Malformed payload: habits is not an array
  const malformedPayload = { ...validPayload, habits: "not-an-array" };
  const v2 = Store.validateBackup(JSON.stringify(malformedPayload));
  assert.strictEqual(v2.valid, false, 'Non-array habits is rejected');
  assert.ok(v2.error.includes('habits'), 'Validation error mentions habits');

  // Existing habits in Store should not be corrupted
  assert.strictEqual(Store.getHabits().length, 1, 'Existing data unaffected by failed validation');
});

// ----------------------------------------------------------------------------
// Test H: Clear All: Store.clearAll() removes habits and refreshing does not reseed
// ----------------------------------------------------------------------------
runTest('H. Clear All: Store.clearAll() removes habits and honors seeded flag', () => {
  Store.saveHabit({ name: 'Habit To Wipe', frequency: 'daily' });
  assert.strictEqual(Store.getHabits().length, 1);

  // Clear all
  Store.clearAll();

  assert.strictEqual(Store.getHabits().length, 0, 'Habits wiped after clearAll');
  assert.strictEqual(Store.getHabitCompletions().length, 0, 'Completions wiped after clearAll');

  // Attempt reseed like app startup does
  Store.seedIfEmpty();
  assert.strictEqual(Store.getHabits().length, 0, 'App does NOT auto-reseed when seeded marker is present');
});

// ----------------------------------------------------------------------------
// Test I: Legacy backup: Pre-v1.5.0 backup lacking habits keys succeeds safely
// ----------------------------------------------------------------------------
runTest('I. Legacy backup: Importing v1.4.0 backup without habits keys succeeds cleanly', () => {
  const legacyBackup = {
    version: '1.4.0',
    exportedAt: '2026-09-01T12:00:00.000Z',
    subjects: [{ id: 's1', name: 'Biology', color: '#10b981' }],
    tasks: [{ id: 't1', title: 'Read Chapter 4', subjectId: 's1', completed: false }],
    notes: [{ id: 'n1', title: 'Cell division', content: 'Notes...' }],
    sessions: [],
    activity: [],
    settings: { pomodoro: { focusMinutes: 25 } }
    // Note: No habits or habitCompletions keys!
  };

  const validation = Store.validateBackup(JSON.stringify(legacyBackup));
  assert.strictEqual(validation.valid, true, 'Legacy backup is valid');
  assert.strictEqual(validation.counts.habits, 0, 'Habits count defaults to 0');
  assert.strictEqual(validation.counts.habitCompletions, 0, 'Completions count defaults to 0');

  const res = Store.applyBackup(validation.normalizedData);
  assert.strictEqual(res.success, true, 'Legacy backup applied without error');
  assert.deepStrictEqual(Store.getHabits(), [], 'Habits array is safely initialized to empty');
  assert.deepStrictEqual(Store.getHabitCompletions(), [], 'Habit completions array is safely initialized to empty');
  assert.strictEqual(Store.getSubjects().length, 1, 'Subjects restored correctly');
});

// ----------------------------------------------------------------------------
// Test J: Future date check-off rejection
// ----------------------------------------------------------------------------
runTest('J. Future date check-off rejection: Completing future date rejected with 0 records', () => {
  const originalTodayISO = Dates.todayISO;
  try {
    Dates.todayISO = () => '2026-09-14';

    const habit = Store.saveHabit({ name: 'Time Travel Habit', frequency: 'daily' });

    // Tomorrow is 2026-09-15
    const toggleRes = Store.toggleHabitCompletion(habit.id, '2026-09-15');
    assert.strictEqual(toggleRes, null, 'toggleHabitCompletion returns null on future date');

    const setRes = Store.setHabitCompletion(habit.id, '2026-09-15', true);
    assert.strictEqual(setRes, false, 'setHabitCompletion returns false on future date');

    const completions = Store.getHabitCompletions(habit.id);
    assert.strictEqual(completions.length, 0, 'No completion records stored for future date');
  } finally {
    Dates.todayISO = originalTodayISO;
  }
});

// ----------------------------------------------------------------------------
// Test K: Weekly rate calculation & status
// ----------------------------------------------------------------------------
runTest('K. Weekly rate calculation: Accurate status & percentage calculation', () => {
  const originalTodayISO = Dates.todayISO;
  try {
    // Simulate today is Sunday 2026-09-20
    Dates.todayISO = () => '2026-09-20';

    const habit = Store.saveHabit({
      name: 'Gym Workout',
      frequency: 'weekdays',
      targetDays: [1, 3, 5] // Mon (14), Wed (16), Fri (18)
    });

    const weekDates = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'];

    // Complete Mon and Wed, miss Fri
    Store.toggleHabitCompletion(habit.id, '2026-09-14');
    Store.toggleHabitCompletion(habit.id, '2026-09-16');

    const weeklyStatus = Store.getHabitWeeklyStatus(habit.id, weekDates);
    assert.strictEqual(weeklyStatus.length, 7);

    // Mon (index 0): scheduled & completed
    assert.strictEqual(weeklyStatus[0].status, 'completed');
    // Tue (index 1): unscheduled
    assert.strictEqual(weeklyStatus[1].status, 'unscheduled');
    // Wed (index 2): scheduled & completed
    assert.strictEqual(weeklyStatus[2].status, 'completed');
    // Thu (index 3): unscheduled
    assert.strictEqual(weeklyStatus[3].status, 'unscheduled');
    // Fri (index 4): scheduled & missed
    assert.strictEqual(weeklyStatus[4].status, 'missed');
    // Sat (index 5): unscheduled
    assert.strictEqual(weeklyStatus[5].status, 'unscheduled');
    // Sun (index 6): unscheduled
    assert.strictEqual(weeklyStatus[6].status, 'unscheduled');

    // Aggregate stats
    const stats = Store.getHabitStats();
    assert.strictEqual(stats.totalWeekScheduled, 3, '3 total scheduled occurrences in the week');
    assert.strictEqual(stats.totalWeekCompleted, 2, '2 completed occurrences in the week');
    assert.strictEqual(stats.rateWeek, 67, '2/3 rounds to 67% weekly rate');
  } finally {
    Dates.todayISO = originalTodayISO;
  }
});

console.log(`\n========================================`);
console.log(`Test Results: ${passedCount} passed, ${failedCount} failed`);
console.log(`========================================\n`);

if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
