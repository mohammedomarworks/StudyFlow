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

console.log('\n========================================');
console.log(`Extension Test Results: ${passedCount} passed, ${failedCount} failed`);
console.log('========================================\n');

if (failedCount > 0) {
  process.exit(1);
}
