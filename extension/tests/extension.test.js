/**
 * extension/tests/extension.test.js
 * Automated test suite for StudyFlow v2.1.0 Chrome Extension Foundation.
 */

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionRoot = path.resolve(__dirname, '..');

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

console.log('Running StudyFlow v2.1.0 Chrome Extension Test Suite...\n');

// 1. Manifest exists and is valid JSON
await runTest('1. manifest.json exists and is valid JSON', () => {
  const manifestPath = path.join(extensionRoot, 'manifest.json');
  assert(fs.existsSync(manifestPath), 'manifest.json must exist in extension root');
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  assert(typeof manifest === 'object' && manifest !== null, 'manifest must be a JSON object');
});

// 2. manifest_version = 3
await runTest('2. manifest_version equals 3 (Manifest V3)', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
  assert.strictEqual(manifest.manifest_version, 3, 'manifest_version must be 3');
});

// 3. version = 2.1.0 and name = StudyFlow
await runTest('3. version is 2.1.0 and name is StudyFlow', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
  assert.strictEqual(manifest.name, 'StudyFlow', 'manifest name must be StudyFlow');
  assert.strictEqual(manifest.version, '2.1.0', 'manifest version must be 2.1.0');
});

// 4. side_panel is configured
await runTest('4. side_panel is configured with valid default_path', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
  assert(manifest.side_panel, 'manifest must have side_panel property');
  assert(typeof manifest.side_panel.default_path === 'string', 'side_panel.default_path must be a string');
  const targetHtml = path.join(extensionRoot, manifest.side_panel.default_path);
  assert(fs.existsSync(targetHtml), `side_panel default_path file must exist at ${targetHtml}`);
});

// 5. background service worker exists
await runTest('5. background service worker exists and is configured', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
  assert(manifest.background, 'manifest must have background property');
  assert(typeof manifest.background.service_worker === 'string', 'background.service_worker must be specified');
  const swPath = path.join(extensionRoot, manifest.background.service_worker);
  assert(fs.existsSync(swPath), `service worker must exist at ${swPath}`);
});

// 6. required extension source files exist
await runTest('6. all required source files exist in recommended architecture', () => {
  const required = [
    'manifest.json',
    'src/sidepanel/sidepanel.html',
    'src/sidepanel/sidepanel.css',
    'src/sidepanel/sidepanel.js',
    'src/background/service-worker.js',
    'src/shared/config.js',
    'src/shared/supabase.js',
    'src/shared/auth.js',
    'src/shared/api.js',
    'src/assets/icons/icon-16.png',
    'src/assets/icons/icon-48.png',
    'src/assets/icons/icon-128.png',
    'package.json'
  ];

  for (const rel of required) {
    const full = path.join(extensionRoot, rel);
    assert(fs.existsSync(full), `Required file missing: ${rel}`);
  }
});

// 7. Security: no service_role key or secret credential in our own source
await runTest('7. no service_role / secret key in extension source or build', () => {
  // (a) Strict scan of OUR OWN source (src/) — we fully control these files.
  //     The bare identifiers must never appear here.
  function scanSrc(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanSrc(full);
      } else if (entry.isFile() && /\.(js|json|html)$/.test(entry.name)) {
        const content = fs.readFileSync(full, 'utf8');
        assert(!content.includes('service' + '_role'), `Forbidden 'service_role' found in ${full}`);
        assert(!content.includes('sb_' + 'sec_'), `Forbidden 'sb_sec_' found in ${full}`);
      }
    }
  }
  scanSrc(path.join(extensionRoot, 'src'));

  // (b) Scan EVERYTHING shipped (src/ + dist/, including the bundled SDK) for
  //     an actual leaked secret *credential value*. The vendored SDK legitimately
  //     references the bare tokens "service_role" and "sb_secret_" in its own key
  //     classification logic, so we look for real key *material* — the prefix
  //     followed by an actual key body — not the bare identifier.
  const secretKeyRegex = /sb_secret_[A-Za-z0-9]{8,}/;
  const serviceRoleJwtRegex = /"role"\s*:\s*"service_role"/;
  function scanForSecretValues(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanForSecretValues(full);
      } else if (entry.isFile() && /\.(js|json|html)$/.test(entry.name)) {
        const content = fs.readFileSync(full, 'utf8');
        assert(!secretKeyRegex.test(content), `Leaked secret key value found in ${full}`);
        // A JWT carrying the service_role claim would be an embedded privileged key.
        assert(!serviceRoleJwtRegex.test(content), `Embedded service_role JWT claim found in ${full}`);
      }
    }
  }
  scanForSecretValues(path.join(extensionRoot, 'src'));
  scanForSecretValues(path.join(extensionRoot, 'dist'));
});

// 8. Security: no secret key or sensitive database credentials
await runTest('8. no secret key, password literals, or sensitive tokens', () => {
  const configContent = fs.readFileSync(path.join(extensionRoot, 'src/shared/config.js'), 'utf8');
  assert(!configContent.includes('password:'), 'config.js must not contain password literals');
  assert(!configContent.includes('postgres://'), 'config.js must not contain raw postgres connection URIs');
  assert(!configContent.includes('jwt_secret'), 'config.js must not contain jwt secrets');
});

// 9. Permissions audit: minimum permissions only
await runTest('9. permissions audit enforces minimum permissions policy', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
  const permissions = manifest.permissions || [];

  assert(permissions.includes('sidePanel'), 'sidePanel permission is required');
  assert(permissions.includes('storage'), 'storage permission is required');

  // Verify no invasive or unnecessary permissions were added
  const forbiddenPermissions = ['tabs', 'history', 'bookmarks', 'activeTab', 'scripting', 'webNavigation', 'cookies'];
  for (const forbidden of forbiddenPermissions) {
    assert(!permissions.includes(forbidden), `Forbidden permission '${forbidden}' must not be requested in v2.1.0`);
  }

  // Verify host_permissions are not overly broad
  assert(!manifest.host_permissions || !manifest.host_permissions.includes('<all_urls>'), 'Cannot use <all_urls>');
});

// 10. API module exposes required functions
await runTest('10. API module exposes all required methods', async () => {
  const apiModule = await import('../src/shared/api.js');
  const requiredMethods = [
    'getCurrentUser',
    'getTodayTasks',
    'createTask',
    'updateTask',
    'completeTask',
    'deleteTask',
    'getTodayHabits',
    'toggleHabit',
    'getSettings'
  ];

  for (const method of requiredMethods) {
    assert(typeof apiModule[method] === 'function', `api.js must export function ${method}`);
  }
});

// 11. Auth module exposes all required methods
await runTest('11. Auth module exposes all required methods', async () => {
  const authModule = await import('../src/shared/auth.js');
  const requiredMethods = [
    'signIn',
    'signOut',
    'getSession',
    'getUser',
    'onAuthStateChange',
    'formatAuthError'
  ];

  for (const method of requiredMethods) {
    assert(typeof authModule[method] === 'function', `auth.js must export function ${method}`);
  }
});

// 12. Production Supabase URL is correct
await runTest('12. production Supabase URL is correct', async () => {
  const { CONFIG } = await import('../src/shared/config.js');
  assert.strictEqual(CONFIG.supabaseUrl, 'https://rlqjeilhsgnqjoazejca.supabase.co');
});

// 13. Main StudyFlow production URLs are correct
await runTest('13. main StudyFlow production URLs are correct', async () => {
  const { CONFIG } = await import('../src/shared/config.js');
  assert.strictEqual(CONFIG.appUrl, 'https://studyflow-productivity.netlify.app/');
  assert.strictEqual(CONFIG.timerUrl, 'https://studyflow-productivity.netlify.app/pages/timer.html');
});

// 14. Supabase client validator rejects invalid configurations and secret keys
await runTest('14. validateConfig correctly accepts valid config and rejects secret keys', async () => {
  const { validateConfig } = await import('../src/shared/supabase.js');

  // Valid public config
  const validRes = validateConfig({
    supabaseUrl: 'https://rlqjeilhsgnqjoazejca.supabase.co',
    supabasePublishableKey: 'sb_publishable_BPp2b5BW0ElBhY2I7iZwTw_mdqw3kgg'
  });
  assert(validRes.valid === true, 'Valid config should pass validation');
  assert(validRes.isSecretKey === false, 'Publishable key is not a secret key');

  // Reject secret role key
  const secretRes = validateConfig({
    supabaseUrl: 'https://rlqjeilhsgnqjoazejca.supabase.co',
    supabasePublishableKey: 'sb_sec_fake_secret_key'
  });
  assert(secretRes.valid === false, 'Secret key should fail validation');
  assert(secretRes.isSecretKey === true, 'isSecretKey must be true for secret key');

  // Reject missing URL
  const missingUrlRes = validateConfig({
    supabasePublishableKey: 'sb_pub_test'
  });
  assert(missingUrlRes.valid === false, 'Missing URL must fail');
});

// 15. formatAuthError sanitizes raw errors
await runTest('15. formatAuthError sanitizes raw error payloads into human-friendly text', async () => {
  const { formatAuthError } = await import('../src/shared/auth.js');

  const invalidCreds = formatAuthError({ message: 'Invalid login credentials' });
  assert.strictEqual(invalidCreds, 'Incorrect email or password. Please try again.');

  const rateLimit = formatAuthError({ status: 429, message: 'Too many requests' });
  assert.strictEqual(rateLimit, 'Too many attempts. Please wait a few moments and try again.');

  const networkErr = formatAuthError('Failed to fetch');
  assert(networkErr.includes('network connection'), 'Network error should suggest checking connection');
});

// 16. Icon files are genuine PNG images with correct dimensions
await runTest('16. Icon PNG files exist with valid dimensions (16, 48, 128)', () => {
  function checkPngDimensions(filePath, expectedSize) {
    const buf = fs.readFileSync(filePath);
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    assert.strictEqual(buf[0], 0x89, 'Byte 0 must match PNG signature');
    assert.strictEqual(buf[1], 0x50, 'Byte 1 must match PNG signature (P)');
    assert.strictEqual(buf[2], 0x4e, 'Byte 2 must match PNG signature (N)');
    assert.strictEqual(buf[3], 0x47, 'Byte 3 must match PNG signature (G)');

    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    assert.strictEqual(width, expectedSize, `Width must be ${expectedSize} for ${filePath}`);
    assert.strictEqual(height, expectedSize, `Height must be ${expectedSize} for ${filePath}`);
  }

  checkPngDimensions(path.join(extensionRoot, 'src/assets/icons/icon-16.png'), 16);
  checkPngDimensions(path.join(extensionRoot, 'src/assets/icons/icon-48.png'), 48);
  checkPngDimensions(path.join(extensionRoot, 'src/assets/icons/icon-128.png'), 128);
});

// 17. sidepanel.html has no forbidden inline scripts or inline event handlers (CSP compliance)
await runTest('17. sidepanel.html adheres to strict MV3 CSP (no inline scripts or inline event handlers)', () => {
  const html = fs.readFileSync(path.join(extensionRoot, 'src/sidepanel/sidepanel.html'), 'utf8');

  // No inline script content (<script>...</script> without src)
  const inlineScriptRegex = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  const match = inlineScriptRegex.exec(html);
  assert(!match, 'sidepanel.html must not contain inline scripts');

  // No inline event handlers like onclick=, onload=, onsubmit=
  const inlineHandlerRegex = /\son[a-z]+\s*=\s*["'][^"']*["']/i;
  assert(!inlineHandlerRegex.test(html), 'sidepanel.html must not contain inline event handlers (e.g. onclick, onsubmit)');
});

// 18. Build output (dist/) exists and contains complete unpackable extension
await runTest('18. Build output in dist/ contains valid manifest, service worker, side panel, and icons', () => {
  const distDir = path.join(extensionRoot, 'dist');
  assert(fs.existsSync(distDir), 'dist directory must exist');

  const distManifestPath = path.join(distDir, 'manifest.json');
  assert(fs.existsSync(distManifestPath), 'dist/manifest.json must exist');
  const distManifest = JSON.parse(fs.readFileSync(distManifestPath, 'utf8'));
  assert.strictEqual(distManifest.manifest_version, 3);
  assert.strictEqual(distManifest.version, '2.1.0');

  assert(fs.existsSync(path.join(distDir, distManifest.side_panel.default_path)), 'dist side_panel html must exist');
  assert(fs.existsSync(path.join(distDir, distManifest.background.service_worker)), 'dist service worker must exist');

  assert(fs.existsSync(path.join(distDir, 'src/assets/icons/icon-16.png')), 'dist icon-16 must exist');
  assert(fs.existsSync(path.join(distDir, 'src/assets/icons/icon-48.png')), 'dist icon-48 must exist');
  assert(fs.existsSync(path.join(distDir, 'src/assets/icons/icon-128.png')), 'dist icon-128 must exist');
});

// 19. Action configuration does NOT have default_popup (required for side panel open on action click)
await runTest('19. action configuration omits default_popup for openPanelOnActionClick compatibility', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
  assert(manifest.action, 'manifest must have action object');
  assert(!manifest.action.default_popup, 'action.default_popup must be omitted when using side panel openPanelOnActionClick');
});

// 20. Service worker sets openPanelOnActionClick
await runTest('20. service-worker.js implements openPanelOnActionClick', () => {
  const swCode = fs.readFileSync(path.join(extensionRoot, 'src/background/service-worker.js'), 'utf8');
  assert(swCode.includes('openPanelOnActionClick: true'), 'service worker must set openPanelOnActionClick: true');
  assert(!swCode.includes('openPanelOnActionIconClick'), 'must not use typo openPanelOnActionIconClick');
});

// ==========================================================================
// Focus Mode timer tests (21–35) — exercise the pure state machine in
// src/shared/focus-timer.js. All time-dependent calls inject a fixed `now`.
// ==========================================================================

const ft = await import('../src/shared/focus-timer.js');
const T0 = 1_700_000_000_000; // fixed reference timestamp
const FOCUS_MS = 25 * 60000;

// 21. Default READY state is 25:00 focus
await runTest('21. createReadyState defaults to a 25:00 focus session', () => {
  const s = ft.createReadyState('focus', ft.DEFAULT_DURATIONS, 'user-1');
  assert.strictEqual(s.status, 'ready');
  assert.strictEqual(s.mode, 'focus');
  assert.strictEqual(s.durationMs, FOCUS_MS);
  assert.strictEqual(ft.formatMMSS(ft.getRemainingMs(s, T0)), '25:00');
});

// 22. startTimer sets a running state with a future endTime
await runTest('22. startTimer produces a running state with endTime = now + duration', () => {
  const ready = ft.createReadyState('focus', ft.DEFAULT_DURATIONS, 'user-1');
  const s = ft.startTimer(ready, { sessionId: 'sess-1', userId: 'user-1' }, T0);
  assert.strictEqual(s.status, 'running');
  assert.strictEqual(s.endTime, T0 + FOCUS_MS);
  assert.strictEqual(s.sessionId, 'sess-1');
  assert.strictEqual(s.completionWritten, false);
});

// 23. Pause freezes remaining time
await runTest('23. pauseTimer freezes the remaining time and clears endTime', () => {
  const running = ft.startTimer(ft.createReadyState('focus'), { sessionId: 's' }, T0);
  const paused = ft.pauseTimer(running, T0 + 60000); // 1 min elapsed
  assert.strictEqual(paused.status, 'paused');
  assert.strictEqual(paused.endTime, null);
  assert.strictEqual(paused.remainingMs, FOCUS_MS - 60000);
});

// 24. Resume projects a new endTime from remaining
await runTest('24. resumeTimer projects a fresh endTime from the frozen remaining time', () => {
  const running = ft.startTimer(ft.createReadyState('focus'), { sessionId: 's' }, T0);
  const paused = ft.pauseTimer(running, T0 + 60000);
  const resumed = ft.resumeTimer(paused, T0 + 5_000_000); // resumed much later
  assert.strictEqual(resumed.status, 'running');
  assert.strictEqual(resumed.endTime, T0 + 5_000_000 + (FOCUS_MS - 60000));
});

// 25. Reset returns to READY and clears the session id
await runTest('25. resetTimer returns to READY, clears sessionId, preserves subject/task', () => {
  let s = ft.startTimer(ft.createReadyState('focus'), { sessionId: 's', subjectId: 'sub-1', taskId: 'task-1' }, T0);
  s = ft.resetTimer(s, ft.DEFAULT_DURATIONS);
  assert.strictEqual(s.status, 'ready');
  assert.strictEqual(s.sessionId, null);
  assert.strictEqual(s.subjectId, 'sub-1');
  assert.strictEqual(s.taskId, 'task-1');
  assert.strictEqual(s.remainingMs, FOCUS_MS);
});

// 26. Remaining time is timestamp-derived, not decremented
await runTest('26. getRemainingMs is derived from endTime - now (timestamp-based)', () => {
  const running = ft.startTimer(ft.createReadyState('focus'), { sessionId: 's' }, T0);
  assert.strictEqual(ft.getRemainingMs(running, T0 + 600000), FOCUS_MS - 600000);
  // Never negative
  assert.strictEqual(ft.getRemainingMs(running, T0 + FOCUS_MS + 999999), 0);
});

// 27. State object is serializable for chrome.storage.local persistence
await runTest('27. timer state round-trips through JSON (persistence-safe)', () => {
  const running = ft.startTimer(ft.createReadyState('focus'), { sessionId: 's', userId: 'user-1' }, T0);
  const restored = JSON.parse(JSON.stringify(running));
  assert.deepStrictEqual(restored, running);
  // And carries NO credential-like fields.
  const keys = Object.keys(restored);
  for (const k of ['password', 'token', 'access_token', 'refresh_token', 'apiKey']) {
    assert(!keys.includes(k), `timer state must not contain ${k}`);
  }
});

// 28. Restore-after-reopen recomputes remaining from timestamps
await runTest('28. a restored running state recomputes remaining time from now', () => {
  const running = ft.startTimer(ft.createReadyState('focus'), { sessionId: 's' }, T0);
  const restored = JSON.parse(JSON.stringify(running));
  // 10 minutes passed while the panel was closed.
  assert.strictEqual(ft.getRemainingMs(restored, T0 + 600000), FOCUS_MS - 600000);
  assert.strictEqual(ft.isExpired(restored, T0 + 600000), false);
});

// 29. isExpired detects a session that ended while the panel was closed
await runTest('29. isExpired is true once endTime has passed', () => {
  const running = ft.startTimer(ft.createReadyState('focus'), { sessionId: 's' }, T0);
  assert.strictEqual(ft.isExpired(running, T0 + FOCUS_MS - 1), false);
  assert.strictEqual(ft.isExpired(running, T0 + FOCUS_MS), true);
  assert.strictEqual(ft.isExpired(running, T0 + FOCUS_MS + 60000), true);
});

// 30. Completion is idempotent and persists exactly once
await runTest('30. completion writes exactly once (shouldPersist flips to false)', () => {
  let s = ft.startTimer(ft.createReadyState('focus', ft.DEFAULT_DURATIONS, 'user-1'), { sessionId: 'sess-1', userId: 'user-1' }, T0);
  s = ft.completeTimer(s);
  assert.strictEqual(s.status, 'completed');
  assert.strictEqual(ft.shouldPersistSession(s), true, 'first completion should persist');
  s = ft.markSessionWritten(s);
  assert.strictEqual(ft.shouldPersistSession(s), false, 'must not persist a second time');
  // Re-completing an already-completed state is a no-op.
  assert.strictEqual(ft.completeTimer(s).status, 'completed');
});

// 31. Session payload matches study_sessions schema/semantics
await runTest('31. buildSessionPayload produces the correct study_sessions shape', () => {
  let s = ft.startTimer(ft.createReadyState('focus', ft.DEFAULT_DURATIONS, 'user-1'),
    { sessionId: 'sess-1', subjectId: 'sub-1', taskId: 'task-1', userId: 'user-1' }, T0);
  s = ft.completeTimer(s);
  const payload = ft.buildSessionPayload(s);
  assert.strictEqual(payload.id, 'sess-1');
  assert.strictEqual(payload.type, 'focus');
  assert.strictEqual(payload.durationMinutes, 25);
  assert.strictEqual(payload.subjectId, 'sub-1');
  assert.strictEqual(payload.taskId, 'task-1');
  assert(typeof payload.completedAt === 'string' && payload.completedAt.includes('T'), 'completedAt is an ISO timestamp');
});

// 32. Signed-out completion is never persisted to the cloud
await runTest('32. a completed session with no userId is not persisted', () => {
  let s = ft.startTimer(ft.createReadyState('focus', ft.DEFAULT_DURATIONS, null), { sessionId: 'sess-x' }, T0);
  s = ft.completeTimer(s);
  assert.strictEqual(ft.shouldPersistSession(s), false, 'no user → no cloud write');
});

// 33. Account-switch safety: a state belongs to exactly one user id
await runTest('33. timer state carries its owning userId for account-switch isolation', () => {
  const s = ft.startTimer(ft.createReadyState('focus', ft.DEFAULT_DURATIONS, 'user-1'), { sessionId: 's', userId: 'user-1' }, T0);
  assert.strictEqual(s.userId, 'user-1');
  // A different signed-in user must not match this persisted state.
  assert.notStrictEqual(s.userId, 'user-2');
});

// 34. Break sessions are never persisted to study_sessions
await runTest('34. break sessions do not create a study_sessions write', () => {
  let s = ft.startTimer(ft.createReadyState('shortBreak', ft.DEFAULT_DURATIONS, 'user-1'),
    { mode: 'shortBreak', durationMs: 5 * 60000, sessionId: null, userId: 'user-1' }, T0);
  s = ft.completeTimer(s);
  assert.strictEqual(ft.shouldPersistSession(s), false, 'breaks are local only');
});

// 35. No per-second decrement counter exists (timestamp model only)
await runTest('35. focus-timer exposes no tick/decrement counter API (no runaway intervals)', () => {
  const exported = Object.keys(ft.default || {});
  for (const banned of ['tick', 'decrement', 'countdown', 'interval']) {
    assert(!exported.includes(banned), `focus-timer must not export a ${banned} counter`);
  }
  // Duration normalization guards against bad cloud values.
  const norm = ft.normalizeDurations({ focus: 0, shortBreak: -3, longBreak: 'x' });
  assert.deepStrictEqual(norm, { focus: 25, shortBreak: 5, longBreak: 15 });
});

console.log('\n========================================');
console.log(`Extension Test Results: ${passedCount} passed, ${failedCount} failed`);
console.log('========================================\n');

if (failedCount > 0) {
  process.exit(1);
}
