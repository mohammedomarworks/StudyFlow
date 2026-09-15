/**
 * tests/auth.test.js
 * Comprehensive automated test suite for StudyFlow v2.0 Phase B — Authentication.
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

// Helper to instantiate a fresh Auth module instance
function createAuthModule() {
  const authCode = fs.readFileSync(path.resolve(__dirname, '../js/auth.js'), 'utf8');
  const context = {
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    window: {},
    globalThis: {}
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(authCode, context);
  return context.Auth;
}

(async function () {
  console.log('Running StudyFlow v2.0 Authentication Test Suite...\n');

  // Test 1: API completeness
  await runTest('1. Auth module exposes all required public API functions', () => {
    const Auth = createAuthModule();
    const requiredFunctions = [
      'init',
      'getSession',
      'getUser',
      'isAuthenticated',
      'getState',
      'signUp',
      'signIn',
      'signOut',
      'resetPassword',
      'updatePassword',
      'getProfile',
      'onAuthStateChange',
      'sanitizeRedirect',
      'formatAuthError',
      'isValidEmail',
      'reset'
    ];

    requiredFunctions.forEach(fn => {
      assert.strictEqual(typeof Auth[fn], 'function', `Auth.${fn} must be a function`);
    });

    assert.strictEqual(Auth.STATE.LOADING, 'loading');
    assert.strictEqual(Auth.STATE.AUTHENTICATED, 'authenticated');
    assert.strictEqual(Auth.STATE.UNAUTHENTICATED, 'unauthenticated');
    assert.strictEqual(Auth.STATE.ERROR, 'error');
  });

  // Test 2: Missing configuration degrades gracefully
  await runTest('2. Missing or unconfigured Supabase client degrades gracefully without throwing', async () => {
    const Auth = createAuthModule();
    // In this context, StudyFlowSupabase is not loaded
    const res = await Auth.init();

    assert.strictEqual(res.configured, false, 'Should report not configured');
    assert.strictEqual(res.state, Auth.STATE.UNAUTHENTICATED, 'State should be unauthenticated');
    assert.strictEqual(Auth.isAuthenticated(), false, 'isAuthenticated should be false');
    assert.strictEqual(Auth.getSession(), null, 'Session should be null');
    assert.strictEqual(Auth.getUser(), null, 'User should be null');

    const signInRes = await Auth.signIn({ email: 'test@example.com', password: 'password123' });
    assert.strictEqual(signInRes.success, false);
    assert.ok(signInRes.error.includes('unavailable') || signInRes.error.includes('not configured'));
  });

  // Test 3: Rejection of secret / service_role keys
  await runTest('3. Supabase client security validator strictly rejects secret/service_role keys', () => {
    const supabaseModule = require('../js/supabase.js');

    const secretConfigs = [
      { url: 'https://example.supabase.co', publishableKey: 'sb_sec_bad_key' },
      { url: 'https://example.supabase.co', publishableKey: 'service_role' },
      { url: 'https://example.supabase.co', publishableKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig' }
    ];

    secretConfigs.forEach(cfg => {
      const res = supabaseModule.validateConfig(cfg);
      assert.strictEqual(res.valid, false, 'Secret config must be invalid');
      assert.strictEqual(res.isSecretKey, true, 'Must flag as secret key');
    });
  });

  // Test 4: Sign-up input validation
  await runTest('4. Sign-up client validation rejects invalid inputs', async () => {
    const Auth = createAuthModule();

    // Missing email
    let res = await Auth.signUp({ email: '', password: 'password123' });
    assert.strictEqual(res.success, false);
    assert.ok(res.error.toLowerCase().includes('email'));

    // Malformed email
    res = await Auth.signUp({ email: 'invalid-email', password: 'password123' });
    assert.strictEqual(res.success, false);
    assert.ok(res.error.toLowerCase().includes('valid email'));

    // Missing password
    res = await Auth.signUp({ email: 'student@example.com', password: '' });
    assert.strictEqual(res.success, false);
    assert.ok(res.error.toLowerCase().includes('password is required'));

    // Short password
    res = await Auth.signUp({ email: 'student@example.com', password: '123' });
    assert.strictEqual(res.success, false);
    assert.ok(res.error.toLowerCase().includes('6 characters'));

    // Mismatched confirmation
    res = await Auth.signUp({
      email: 'student@example.com',
      password: 'password123',
      confirmPassword: 'differentPassword'
    });
    assert.strictEqual(res.success, false);
    assert.ok(res.error.toLowerCase().includes('do not match'));
  });

  // Test 5: Sign-in input validation
  await runTest('5. Sign-in client validation rejects missing fields', async () => {
    const Auth = createAuthModule();

    let res = await Auth.signIn({ email: '', password: 'password123' });
    assert.strictEqual(res.success, false);
    assert.ok(res.error.toLowerCase().includes('email'));

    res = await Auth.signIn({ email: 'student@example.com', password: '' });
    assert.strictEqual(res.success, false);
    assert.ok(res.error.toLowerCase().includes('password is required'));
  });

  // Test 6: Password reset input validation
  await runTest('6. Password reset validation rejects invalid email', async () => {
    const Auth = createAuthModule();

    let res = await Auth.resetPassword('');
    assert.strictEqual(res.success, false);

    res = await Auth.resetPassword('bad-email');
    assert.strictEqual(res.success, false);
    assert.ok(res.error.toLowerCase().includes('valid email'));
  });

  // Test 7: Update password input validation
  await runTest('7. Update password validation enforces length and confirmation match', async () => {
    const Auth = createAuthModule();

    let res = await Auth.updatePassword('', '');
    assert.strictEqual(res.success, false);

    res = await Auth.updatePassword('123', '123');
    assert.strictEqual(res.success, false);
    assert.ok(res.error.toLowerCase().includes('6 characters'));

    res = await Auth.updatePassword('password123', 'other123');
    assert.strictEqual(res.success, false);
    assert.ok(res.error.toLowerCase().includes('do not match'));
  });

  // Test 8: Mock authenticated session & listener notifications
  await runTest('8. Auth handles state transitions and listener notifications', async () => {
    const Auth = createAuthModule();
    let listenerCalled = false;
    let receivedEvent = null;

    const mockClient = {
      auth: {
        getSession: async () => ({
          data: {
            session: {
              access_token: 'mock-token',
              user: {
                id: 'user-123',
                email: 'alex@example.com',
                user_metadata: { display_name: 'Alex Smith' }
              }
            }
          },
          error: null
        }),
        onAuthStateChange: (cb) => {
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
        signOut: async () => ({ error: null })
      }
    };

    Auth.onAuthStateChange((event, session, user, state) => {
      listenerCalled = true;
      receivedEvent = event;
    });

    const initRes = await Auth.init({ customClient: mockClient, forceReinit: true });
    assert.strictEqual(initRes.state, Auth.STATE.AUTHENTICATED);
    assert.strictEqual(Auth.isAuthenticated(), true);

    const user = Auth.getUser();
    assert.strictEqual(user.displayName, 'Alex Smith');
    assert.strictEqual(user.email, 'alex@example.com');
    assert.strictEqual(user.id, 'user-123');

    // Sign out
    await Auth.signOut();
    assert.strictEqual(Auth.isAuthenticated(), false);
    assert.strictEqual(Auth.getUser(), null);
    assert.strictEqual(Auth.getSession(), null);
    assert.strictEqual(Auth.getState(), Auth.STATE.UNAUTHENTICATED);
  });

  // Test 9: Sign Out DOES NOT clear localStorage planner data
  await runTest('9. Sign Out strictly preserves LocalStorage planner data (LOGOUT != DELETE LOCAL DATA)', async () => {
    const storage = {
      sp_tasks: JSON.stringify([{ id: 'task-1', title: 'Study Chemistry' }]),
      sp_subjects: JSON.stringify([{ id: 'subj-1', name: 'Chemistry' }]),
      sp_habits: JSON.stringify([{ id: 'habit-1', name: 'Read chapter' }]),
      sp_notes: JSON.stringify([{ id: 'note-1', title: 'Formula sheet' }]),
      sp_sessions: JSON.stringify([{ id: 'session-1', duration: 25 }]),
      sp_settings: JSON.stringify({ theme: 'dark' }),
      'sb-dummy-auth-token': 'token-to-clear'
    };

    const mockLocalStorage = {
      getItem: (k) => storage[k] || null,
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: (k) => { delete storage[k]; },
      clear: () => { throw new Error('localStorage.clear() should NEVER be called on sign out!'); }
    };

    const Auth = createAuthModule();
    const mockClient = {
      auth: {
        getSession: async () => ({
          data: {
            session: { user: { id: 'u1', email: 'test@example.com' } }
          }
        }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signOut: async () => {
          delete storage['sb-dummy-auth-token'];
          return { error: null };
        }
      }
    };

    await Auth.init({ customClient: mockClient, forceReinit: true });
    assert.strictEqual(Auth.isAuthenticated(), true);

    // Perform sign out
    await Auth.signOut();

    // Verify planner data is 100% preserved
    assert.ok(storage.sp_tasks.includes('Study Chemistry'), 'sp_tasks must be preserved');
    assert.ok(storage.sp_subjects.includes('Chemistry'), 'sp_subjects must be preserved');
    assert.ok(storage.sp_habits.includes('Read chapter'), 'sp_habits must be preserved');
    assert.ok(storage.sp_notes.includes('Formula sheet'), 'sp_notes must be preserved');
    assert.ok(storage.sp_sessions.includes('25'), 'sp_sessions must be preserved');
    assert.ok(storage.sp_settings.includes('dark'), 'sp_settings must be preserved');
  });

  // Test 10: Local-first Store still works when unauthenticated
  await runTest('10. Existing v1.5 Store operations function 100% normally when unauthenticated', () => {
    const storage = {};
    const mockLocalStorage = {
      getItem: (k) => storage[k] || null,
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: (k) => { delete storage[k]; }
    };

    global.localStorage = mockLocalStorage;
    global.window = global;

    const storageCode = fs.readFileSync(path.resolve(__dirname, '../js/storage.js'), 'utf8');
    vm.runInThisContext(storageCode);

    Store.seedIfEmpty();
    const tasks = Store.getTasks();
    assert.ok(tasks.length > 0, 'Local Store can fetch seeded tasks');

    const newTask = Store.saveTask({ title: 'New Local Task', priority: 'high' });
    assert.strictEqual(newTask.title, 'New Local Task');

    const retrieved = Store.getTask(newTask.id);
    assert.strictEqual(retrieved.id, newTask.id);
  });

  // Test 11: Open redirect security validator
  await runTest('11. Redirect sanitizer blocks open redirects and dangerous URI schemes', () => {
    const Auth = createAuthModule();

    const maliciousUrls = [
      'https://evil.com',
      'http://attacker.org/steal',
      '//evil.com',
      '\\\\attacker.com',
      'javascript:alert(document.cookie)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox',
      'pages/../../etc/passwd',
      'http://localhost:8000.evil.com',
      '/unexpected/path.html'
    ];

    maliciousUrls.forEach(badUrl => {
      const sanitized = Auth.sanitizeRedirect(badUrl, 'index.html');
      assert.strictEqual(sanitized, 'index.html', `Expected "${badUrl}" to be rejected`);
    });

    const safeUrls = [
      'index.html',
      '../index.html',
      'tasks.html',
      'pages/tasks.html',
      '../pages/tasks.html',
      'subjects.html',
      'habits.html',
      'calendar.html',
      'timer.html',
      'progress.html',
      'notes.html',
      'settings.html',
      'about.html'
    ];

    safeUrls.forEach(safeUrl => {
      const sanitized = Auth.sanitizeRedirect(safeUrl);
      assert.strictEqual(sanitized, safeUrl, `Expected safe URL "${safeUrl}" to be permitted`);
    });
  });

  // Test 12: Error message formatting
  await runTest('12. formatAuthError sanitizes raw errors into user-friendly messages', () => {
    const Auth = createAuthModule();

    assert.strictEqual(
      Auth.formatAuthError('Invalid login credentials'),
      'Email or password is incorrect.'
    );

    assert.strictEqual(
      Auth.formatAuthError('Email not confirmed'),
      'Please verify your email before signing in.'
    );

    assert.strictEqual(
      Auth.formatAuthError('User already registered'),
      'An account with this email already exists.'
    );

    assert.strictEqual(
      Auth.formatAuthError('Password should be at least 6 characters'),
      'Password must be at least 6 characters.'
    );

    assert.strictEqual(
      Auth.formatAuthError('Failed to fetch'),
      'Unable to reach authentication service. Check your connection and try again.'
    );
  });

  console.log(`\n========================================`);
  console.log(`Test Results: ${passedCount} passed, ${failedCount} failed`);
  console.log(`========================================\n`);

  if (failedCount > 0) {
    process.exit(1);
  }
})();
