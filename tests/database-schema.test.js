/**
 * tests/database-schema.test.js
 * Automated Verification Suite for StudyFlow v2.0 Phase A (Supabase Foundation).
 *
 * Verifies:
 * 1. SQL Schema migration existence & syntax integrity
 * 2. All 9 tables with specified columns, defaults, and UUID types
 * 3. Safe ON DELETE behaviors (SET NULL for subjects, CASCADE for user/completions)
 * 4. Unique constraints (habit_id + date, settings user_id PK)
 * 5. All performance indexes
 * 6. Row Level Security (RLS) enabled on all tables
 * 7. Granular policies targeting `TO authenticated`
 * 8. Cross-user reference ownership guards in RLS & database triggers
 * 9. New user auth trigger provisioning profiles & settings
 * 10. Supabase client configuration validation & secret key rejection
 * 11. Repository abstraction boundary behavior
 */

const fs = require('fs');
const path = require('path');
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

console.log('Running StudyFlow v2.0 Database Schema & Foundation Test Suite...\n');

// Load SQL Migration
const migrationPath = path.resolve(__dirname, '../supabase/migrations/0001_initial_schema.sql');
assert.ok(fs.existsSync(migrationPath), 'Migration file 0001_initial_schema.sql must exist');
const sqlContent = fs.readFileSync(migrationPath, 'utf8');

// Load JS modules
const StudyFlowSupabase = require('../js/supabase.js');
const StudyFlowRepository = require('../js/repository.js');

// ----------------------------------------------------------------------------
// Test 1: All 9 Required Tables Exist
// ----------------------------------------------------------------------------
runTest('1. Schema defines all 9 required tables', () => {
  const requiredTables = [
    'profiles',
    'subjects',
    'tasks',
    'notes',
    'habits',
    'habit_completions',
    'study_sessions',
    'activity',
    'settings'
  ];

  for (const table of requiredTables) {
    const tableRegex = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?public\\.${table}\\b`, 'i');
    assert.ok(tableRegex.test(sqlContent), `Table public.${table} must be defined in migration`);
  }
});

// ----------------------------------------------------------------------------
// Test 2: User references & ON DELETE cascade to auth.users
// ----------------------------------------------------------------------------
runTest('2. All user-owned tables reference auth.users(id) with ON DELETE CASCADE', () => {
  const userOwnedTables = [
    'profiles',
    'subjects',
    'tasks',
    'notes',
    'habits',
    'habit_completions',
    'study_sessions',
    'activity',
    'settings'
  ];

  for (const table of userOwnedTables) {
    // Each table should reference auth.users(id) ON DELETE CASCADE
    const tableBlockMatch = sqlContent.match(new RegExp(`CREATE\\s+TABLE[\\s\\S]*?public\\.${table}[\\s\\S]*?\\);`, 'i'));
    assert.ok(tableBlockMatch, `Found definition for table ${table}`);
    const block = tableBlockMatch[0];
    assert.ok(
      /REFERENCES\s+auth\.users\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i.test(block),
      `Table public.${table} must reference auth.users(id) ON DELETE CASCADE`
    );
  }
});

// ----------------------------------------------------------------------------
// Test 3: Safe ON DELETE SET NULL for subject and task references
// ----------------------------------------------------------------------------
runTest('3. Deleting a subject preserves tasks, notes, habits, and study sessions (ON DELETE SET NULL)', () => {
  // tasks.subject_id
  const tasksMatch = sqlContent.match(/CREATE\s+TABLE[\s\S]*?public\.tasks[\s\S]*?\);/i)[0];
  assert.ok(
    /subject_id\s+uuid\s+REFERENCES\s+public\.subjects\s*\(\s*id\s*\)\s+ON\s+DELETE\s+SET\s+NULL/i.test(tasksMatch),
    'tasks.subject_id must use ON DELETE SET NULL'
  );

  // notes.subject_id
  const notesMatch = sqlContent.match(/CREATE\s+TABLE[\s\S]*?public\.notes[\s\S]*?\);/i)[0];
  assert.ok(
    /subject_id\s+uuid\s+REFERENCES\s+public\.subjects\s*\(\s*id\s*\)\s+ON\s+DELETE\s+SET\s+NULL/i.test(notesMatch),
    'notes.subject_id must use ON DELETE SET NULL'
  );

  // habits.subject_id
  const habitsMatch = sqlContent.match(/CREATE\s+TABLE[\s\S]*?public\.habits[\s\S]*?\);/i)[0];
  assert.ok(
    /subject_id\s+uuid\s+REFERENCES\s+public\.subjects\s*\(\s*id\s*\)\s+ON\s+DELETE\s+SET\s+NULL/i.test(habitsMatch),
    'habits.subject_id must use ON DELETE SET NULL'
  );

  // study_sessions.subject_id & task_id
  const sessionsMatch = sqlContent.match(/CREATE\s+TABLE[\s\S]*?public\.study_sessions[\s\S]*?\);/i)[0];
  assert.ok(
    /subject_id\s+uuid\s+REFERENCES\s+public\.subjects\s*\(\s*id\s*\)\s+ON\s+DELETE\s+SET\s+NULL/i.test(sessionsMatch),
    'study_sessions.subject_id must use ON DELETE SET NULL'
  );
  assert.ok(
    /task_id\s+uuid\s+REFERENCES\s+public\.tasks\s*\(\s*id\s*\)\s+ON\s+DELETE\s+SET\s+NULL/i.test(sessionsMatch),
    'study_sessions.task_id must use ON DELETE SET NULL'
  );
});

// ----------------------------------------------------------------------------
// Test 4: Habit completions cascade on habit deletion & unique constraint
// ----------------------------------------------------------------------------
runTest('4. Habit completions cascade on habit deletion and enforce UNIQUE(habit_id, date)', () => {
  const completionsMatch = sqlContent.match(/CREATE\s+TABLE[\s\S]*?public\.habit_completions[\s\S]*?\);/i)[0];

  assert.ok(
    /habit_id\s+uuid\s+NOT\s+NULL\s+REFERENCES\s+public\.habits\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i.test(completionsMatch),
    'habit_completions.habit_id must use ON DELETE CASCADE'
  );

  assert.ok(
    /UNIQUE\s*\(\s*habit_id\s*,\s*date\s*\)/i.test(completionsMatch),
    'habit_completions must enforce UNIQUE(habit_id, date)'
  );
});

// ----------------------------------------------------------------------------
// Test 5: Settings user_id is primary key (single row per user)
// ----------------------------------------------------------------------------
runTest('5. Settings table enforces single row per user via user_id PRIMARY KEY', () => {
  const settingsMatch = sqlContent.match(/CREATE\s+TABLE[\s\S]*?public\.settings[\s\S]*?\);/i)[0];
  assert.ok(
    /user_id\s+uuid\s+PRIMARY\s+KEY\s+REFERENCES\s+auth\.users/i.test(settingsMatch),
    'settings.user_id must be the PRIMARY KEY'
  );
});

// ----------------------------------------------------------------------------
// Test 6: Required performance indexes are created
// ----------------------------------------------------------------------------
runTest('6. All required performance indexes exist in migration', () => {
  const requiredIndexes = [
    'idx_subjects_user_id',
    'idx_tasks_user_id',
    'idx_tasks_user_id_due_date',
    'idx_tasks_user_id_completed',
    'idx_tasks_subject_id',
    'idx_notes_user_id',
    'idx_notes_subject_id',
    'idx_notes_user_id_updated_at',
    'idx_habits_user_id',
    'idx_habits_subject_id',
    'idx_habits_user_id_archived',
    'idx_habit_completions_user_id',
    'idx_habit_completions_habit_id',
    'idx_habit_completions_user_id_date',
    'idx_study_sessions_user_id',
    'idx_study_sessions_user_id_completed_at',
    'idx_study_sessions_subject_id',
    'idx_study_sessions_task_id',
    'idx_activity_user_id',
    'idx_activity_user_id_timestamp'
  ];

  for (const idx of requiredIndexes) {
    const idxRegex = new RegExp(`CREATE\\s+INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${idx}\\b`, 'i');
    assert.ok(idxRegex.test(sqlContent), `Index ${idx} must be created in migration`);
  }
});

// ----------------------------------------------------------------------------
// Test 7: Row Level Security enabled on all 9 tables
// ----------------------------------------------------------------------------
runTest('7. Row Level Security is enabled on every user-owned table', () => {
  const tables = [
    'profiles',
    'subjects',
    'tasks',
    'notes',
    'habits',
    'habit_completions',
    'study_sessions',
    'activity',
    'settings'
  ];

  for (const table of tables) {
    const rlsRegex = new RegExp(`ALTER\\s+TABLE\\s+public\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i');
    assert.ok(rlsRegex.test(sqlContent), `RLS must be enabled on public.${table}`);
  }
});

// ----------------------------------------------------------------------------
// Test 8: Granular RLS policies target `TO authenticated` and check `auth.uid()`
// ----------------------------------------------------------------------------
runTest('8. RLS policies explicitly target authenticated role and use auth.uid()', () => {
  const tables = [
    'profiles',
    'subjects',
    'tasks',
    'notes',
    'habits',
    'habit_completions',
    'study_sessions',
    'activity',
    'settings'
  ];

  for (const table of tables) {
    for (const action of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      const policyRegex = new RegExp(`CREATE\\s+POLICY\\s+["']?${table}_${action.toLowerCase()}_authenticated["']?\\s+ON\\s+public\\.${table}\\s+FOR\\s+${action}\\s+TO\\s+authenticated`, 'i');
      assert.ok(policyRegex.test(sqlContent), `Policy for ${table} ${action} TO authenticated must exist`);
    }
  }

  // Ensure no policy grants anonymous access
  assert.ok(!/TO\s+anon\b/i.test(sqlContent), 'No RLS policies should target the anon role');
});

// ----------------------------------------------------------------------------
// Test 9: Foreign-Key Ownership Security in RLS & Database Triggers
// ----------------------------------------------------------------------------
runTest('9. Cross-user reference ownership protections present in RLS and triggers', () => {
  // Tasks RLS must check subjects.user_id = auth.uid()
  assert.ok(
    /SELECT\s+1\s+FROM\s+public\.subjects\s+WHERE\s+subjects\.id\s*=\s*tasks\.subject_id\s+AND\s+subjects\.user_id\s*=\s*auth\.uid\(\)/i.test(sqlContent),
    'Tasks RLS must prevent referencing foreign subjects'
  );

  // Notes RLS check
  assert.ok(
    /SELECT\s+1\s+FROM\s+public\.subjects\s+WHERE\s+subjects\.id\s*=\s*notes\.subject_id\s+AND\s+subjects\.user_id\s*=\s*auth\.uid\(\)/i.test(sqlContent),
    'Notes RLS must prevent referencing foreign subjects'
  );

  // Habit completions RLS check
  assert.ok(
    /SELECT\s+1\s+FROM\s+public\.habits\s+WHERE\s+habits\.id\s*=\s*habit_completions\.habit_id\s+AND\s+habits\.user_id\s*=\s*auth\.uid\(\)/i.test(sqlContent),
    'Habit completions RLS must prevent referencing foreign habits'
  );

  // Database trigger function for entity ownership check
  assert.ok(
    /FUNCTION\s+public\.check_entity_ownership\(\)/i.test(sqlContent),
    'check_entity_ownership function must be defined'
  );
  assert.ok(
    /tr_tasks_ownership/i.test(sqlContent) &&
    /tr_notes_ownership/i.test(sqlContent) &&
    /tr_habits_ownership/i.test(sqlContent) &&
    /tr_habit_completions_ownership/i.test(sqlContent) &&
    /tr_study_sessions_ownership/i.test(sqlContent),
    'Ownership triggers must be attached to tasks, notes, habits, completions, and sessions'
  );
});

// ----------------------------------------------------------------------------
// Test 10: Auth user creation trigger for profiles and settings
// ----------------------------------------------------------------------------
runTest('10. Trigger provisions profiles and settings rows upon auth.users INSERT', () => {
  assert.ok(
    /FUNCTION\s+public\.handle_new_user\(\)/i.test(sqlContent),
    'handle_new_user function must be defined'
  );
  assert.ok(
    /SECURITY\s+DEFINER\s+SET\s+search_path\s*=\s*public/i.test(sqlContent),
    'handle_new_user must use SECURITY DEFINER SET search_path = public'
  );
  assert.ok(
    /INSERT\s+INTO\s+public\.profiles/i.test(sqlContent) &&
    /INSERT\s+INTO\s+public\.settings/i.test(sqlContent),
    'handle_new_user must provision both profiles and settings rows'
  );
  assert.ok(
    /CREATE\s+TRIGGER\s+on_auth_user_created\s+AFTER\s+INSERT\s+ON\s+auth\.users/i.test(sqlContent),
    'on_auth_user_created trigger must be attached to auth.users'
  );
});

// ----------------------------------------------------------------------------
// Test 11: Supabase client validation & secret key rejection
// ----------------------------------------------------------------------------
runTest('11. StudyFlowSupabase validates config and strictly rejects secret/service_role keys', () => {
  // Empty config
  const emptyRes = StudyFlowSupabase.validateConfig({});
  assert.strictEqual(emptyRes.valid, false);
  assert.ok(emptyRes.errors.length > 0);

  // Secret service_role string key
  const secretKeyRes = StudyFlowSupabase.validateConfig({
    url: 'https://example.supabase.co',
    publishableKey: 'sb_sec_1234567890'
  });
  assert.strictEqual(secretKeyRes.valid, false);
  assert.strictEqual(secretKeyRes.isSecretKey, true);

  // JWT with service_role payload
  const serviceRoleJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
    Buffer.from(JSON.stringify({ role: 'service_role', sub: 'admin' })).toString('base64') +
    '.signature';
  const jwtRes = StudyFlowSupabase.validateConfig({
    url: 'https://example.supabase.co',
    publishableKey: serviceRoleJwt
  });
  assert.strictEqual(jwtRes.valid, false);
  assert.strictEqual(jwtRes.isSecretKey, true);

  // Valid publishable key
  const validRes = StudyFlowSupabase.validateConfig({
    url: 'https://example.supabase.co',
    publishableKey: 'sb_pub_valid_anon_key_12345'
  });
  assert.strictEqual(validRes.valid, true);
  assert.strictEqual(validRes.isSecretKey, false);

  // getClient() with invalid config returns null gracefully without throwing
  const client = StudyFlowSupabase.getClient({
    customConfig: { url: '', publishableKey: '' },
    forceReinit: true
  });
  assert.strictEqual(client, null);
});

// ----------------------------------------------------------------------------
// Test 12: Repository Abstraction Boundary
// ----------------------------------------------------------------------------
runTest('12. StudyFlowRepository provides LocalRepository & CloudRepository boundary', async () => {
  const { RepositoryFactory, LocalRepository, CloudRepository } = StudyFlowRepository;

  // Mock Store
  const mockStore = {
    getTasks: () => [{ id: 't1', title: 'Test Task' }],
    getSubjects: () => [{ id: 's1', name: 'Math' }]
  };

  const localRepo = RepositoryFactory.getRepository('local', { store: mockStore });
  assert.ok(localRepo instanceof LocalRepository);

  const tasks = await localRepo.getTasks();
  assert.strictEqual(tasks.length, 1);
  assert.strictEqual(tasks[0].title, 'Test Task');

  const cloudRepo = RepositoryFactory.getRepository('cloud');
  assert.ok(cloudRepo instanceof CloudRepository);

  // CloudRepository methods should reject when unauthenticated or unconfigured
  await assert.rejects(
    () => cloudRepo.getTasks(),
    /(User is not authenticated|Supabase client is not initialized)/
  );
});

// ----------------------------------------------------------------------------
// Test 13: Connectivity Test Runner (supabase-test.js)
// ----------------------------------------------------------------------------
runTest('13. StudyFlowSupabaseTest runs safely in unconfigured and mock configured states', async () => {
  const StudyFlowSupabaseTest = require('../js/supabase-test.js');

  // Test 1: Empty config notice
  const emptyRes = await StudyFlowSupabaseTest.run({ verbose: false });
  assert.strictEqual(emptyRes.failed, 0);
  assert.strictEqual(emptyRes.warnings, 1);

  // Test 2: Mock configured state
  globalThis.STUDYFLOW_SUPABASE_CONFIG = {
    url: 'https://demo.supabase.co',
    publishableKey: 'sb_pub_test_key_12345'
  };

  const mockClient = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null })
    },
    from: () => ({
      select: () => ({
        limit: async () => ({ data: [], error: null })
      })
    })
  };

  globalThis.supabase = {
    createClient: () => mockClient
  };

  StudyFlowSupabase.reset();
  const mockRes = await StudyFlowSupabaseTest.run({ verbose: false });
  assert.strictEqual(mockRes.failed, 0);
  assert.strictEqual(mockRes.passed, 4);

  // Clean up globals
  delete globalThis.STUDYFLOW_SUPABASE_CONFIG;
  delete globalThis.supabase;
  StudyFlowSupabase.reset();
});

console.log(`\n========================================`);
console.log(`Test Results: ${passedCount} passed, ${failedCount} failed`);
console.log(`========================================\n`);

if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
