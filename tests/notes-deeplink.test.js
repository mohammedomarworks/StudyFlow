/**
 * tests/notes-deeplink.test.js
 * Regression coverage for the "Note not found" deep-link failure that occurred
 * when a note created in the cloud (e.g. from the browser extension's
 * "Save page as Note" / "Save selected text as Note") was opened via
 * pages/notes.html?noteId=<id> before the per-user cloud cache had hydrated.
 *
 * These tests model the two-layer read that Store.getNote performs in cloud
 * mode (it reads sp_cloud_sp_notes_<uid>, which hydrateCache fills
 * asynchronously) and assert that the deep-link handler now pulls from the
 * cloud once on a cache miss before declaring the note missing.
 */

const fs = require('fs');
const path = require('path');
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

async function main() {
console.log('Running Notes Deep-Link Regression Suite...\n');

const rootDir = path.resolve(__dirname, '..');
const notesSrc = fs.readFileSync(path.join(rootDir, 'js/notes.js'), 'utf8');

// ---------------------------------------------------------------------------
// A tiny model of the runtime: the local cache Store.getNote reads, plus a
// cloud backend that hydrateCache copies into that cache. This mirrors the
// real key routing (Store reads the same cache hydrateCache writes) without
// pulling in the DOM.
// ---------------------------------------------------------------------------
function makeWorld({ cloudNotes }) {
  const cache = []; // stands in for sp_cloud_sp_notes_<uid>
  const Store = { getNote: (id) => cache.find(n => n.id === id) || null };
  const repo = {
    async hydrateCache() {
      cache.length = 0;
      cloudNotes.forEach(n => cache.push({ ...n }));
      return { notes: cloudNotes.slice() };
    }
  };
  return { Store, repo, cache };
}

// Faithful reimplementation of the fixed handler's decision logic.
async function resolveDeepLink(noteId, { Store, repo }) {
  let note = Store.getNote(noteId);
  if (!note) {
    await repo.hydrateCache();
    note = Store.getNote(noteId);
  }
  return note ? { opened: noteId } : { toast: 'Note not found or may have been deleted' };
}

// 1. Page note creation: a note that exists only in the cloud resolves.
await runTest('1. deep link to a cloud-only page note resolves after hydration', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const world = makeWorld({ cloudNotes: [{ id, title: 'example.com', content: 'Source: https://example.com/a' }] });
  const res = await resolveDeepLink(id, world);
  assert.strictEqual(res.opened, id, 'note should open, not toast not-found');
});

// 2. Selected-text note creation resolves the same way.
await runTest('2. deep link to a cloud-only selected-text note resolves after hydration', async () => {
  const id = '22222222-2222-4222-8222-222222222222';
  const world = makeWorld({ cloudNotes: [{ id, title: 'Page', content: 'highlighted\n\nSource:\nPage\nhttps://example.com/x' }] });
  const res = await resolveDeepLink(id, world);
  assert.strictEqual(res.opened, id);
});

// 3. This is the EXACT failure: without a cloud pull, an un-hydrated cache
//    yields the false "Note not found" toast.
await runTest('3. reproduces the pre-fix failure: sync cache miss = false "Note not found"', () => {
  const id = '33333333-3333-4333-8333-333333333333';
  const world = makeWorld({ cloudNotes: [{ id, title: 'Real note' }] });
  // Simulate the OLD synchronous-only path (no hydration fallback).
  const note = world.Store.getNote(id);
  assert.strictEqual(note, null, 'cache is empty before hydration — this is what caused the bug');
});

// 4. Returned database note id is the id the deep link must use and find.
await runTest('4. the created note keeps its real DB id end to end', async () => {
  const dbId = '44444444-4444-4444-8444-444444444444'; // as returned by createNote().id
  const world = makeWorld({ cloudNotes: [{ id: dbId, title: 'X' }] });
  const res = await resolveDeepLink(dbId, world);
  assert.strictEqual(res.opened, dbId);
});

// 5. A genuinely missing note still reports not found (no false positives).
await runTest('5. a truly missing note still reports "Note not found"', async () => {
  const world = makeWorld({ cloudNotes: [] });
  const res = await resolveDeepLink('does-not-exist', world);
  assert.strictEqual(res.toast, 'Note not found or may have been deleted');
});

// 6. Source guard: the fix is actually wired into notes.js.
await runTest('6. notes.js deep-link handler pulls from cloud before "Note not found"', () => {
  assert(notesSrc.includes('resolveNoteFromCloud'), 'cloud-resolve fallback present');
  assert(notesSrc.includes('hydrateCache'), 'reuses existing hydrateCache path (no repo rewrite)');
  const resolveIdx = notesSrc.indexOf('resolveNoteFromCloud(noteId)');
  const toastIdx = notesSrc.indexOf("'Note not found or may have been deleted'");
  assert(resolveIdx > -1 && toastIdx > -1 && resolveIdx < toastIdx,
    'cloud resolve is attempted before the not-found toast');
});

// ---------------------------------------------------------------------------
// Init-ordering model — reproduces the REAL runtime the extension deep link
// hits, where notes.js runs at DOMContentLoaded but the Supabase session
// restore (Auth.init) and the cloud-mode selection it drives resolve LATER.
// Store.getNote routes its read key by the factory mode, exactly like
// storage.js _getActiveKey, so these fakes exercise the true key alignment.
// ---------------------------------------------------------------------------
function makeRuntime({ userId, migrated, cloudNotes }) {
  const store = new Map(); // fake localStorage

  const factory = {
    _mode: 'local',
    _uid: null,
    getMode() { return this._mode; },
    getActiveUserId() { return this._uid; },
    setMode(mode, uid = null) { this._mode = mode; this._uid = uid; },
    getActive() {
      return {
        // hydrateCache writes sp_cloud_sp_notes_<uid> — the same key Store reads.
        async hydrateCache(u) {
          const id = u || factory._uid;
          store.set(`sp_cloud_sp_notes_${id}`, JSON.stringify(cloudNotes));
          return { notes: cloudNotes };
        }
      };
    },
    // Mirrors RepositoryFactory.init(): inspects the restored auth user +
    // migration state, then selects cloud mode. Only valid AFTER Auth.init.
    async init() {
      const u = Auth.getUser();
      if (u && u.id && migrated) {
        this.setMode('cloud', u.id);
        this.getActive().hydrateCache(u.id).catch(() => {});
      } else {
        this.setMode('local');
      }
      return this.getActive();
    }
  };

  let _user = null;
  let _initPromise = null;
  const Auth = {
    init() {
      if (_initPromise) return _initPromise;
      // Async, like the real Supabase session restore.
      _initPromise = Promise.resolve().then(() => { _user = { id: userId }; return { user: _user }; });
      return _initPromise;
    },
    getUser() { return _user; }
  };

  // storage.js _getActiveKey + getNote, faithfully.
  const activeKey = (base) =>
    (factory.getMode() === 'cloud' && factory.getActiveUserId())
      ? `sp_cloud_${base}_${factory.getActiveUserId()}`
      : base;
  const Store = {
    getNote(id) {
      const raw = store.get(activeKey('sp_notes'));
      const list = raw ? JSON.parse(raw) : [];
      return list.find(n => n.id === id) || null;
    }
  };

  return { factory, Auth, Store, store };
}

// The fixed handler's readiness gate + resolve, mirroring notes.js.
async function resolveWithReadiness(noteId, rt) {
  await rt.Auth.init();            // idempotent session restore
  await rt.factory.init();         // mode selection + background hydrate
  if (rt.factory.getMode() === 'cloud') {
    await rt.factory.getActive().hydrateCache(); // await FULL hydration
  }
  return rt.Store.getNote(noteId);
}

// 7. At DOMContentLoaded the factory is still 'local' (auth not restored) —
//    this is the exact state the old code misread as "not found".
await runTest('7. before readiness the factory is in local mode and the note is invisible', () => {
  const id = '77777777-7777-4777-8777-777777777777';
  const rt = makeRuntime({ userId: 'user-1', migrated: true, cloudNotes: [{ id, title: 'Clip' }] });
  assert.strictEqual(rt.factory.getMode(), 'local', 'mode not yet cloud at deep-link time');
  assert.strictEqual(rt.Store.getNote(id), null, 'cloud note is invisible before readiness');
});

// 8. Why the previous fix failed: its guard `getMode() !== 'cloud' → return
//    null` short-circuits at exactly this moment, so it NEVER pulled the note.
await runTest('8. old mode-guard returns null at deep-link time (root cause of the repeat failure)', () => {
  const id = '88888888-8888-4888-8888-888888888888';
  const rt = makeRuntime({ userId: 'user-1', migrated: true, cloudNotes: [{ id, title: 'Clip' }] });
  const oldResolve = (rf) => (rf.getMode() !== 'cloud') ? null : 'would-pull';
  assert.strictEqual(oldResolve(rt.factory), null, 'old guard bails before cloud mode is set → false not-found');
});

// 9. The fix: awaiting Auth.init + factory.init + hydration resolves the note.
await runTest('9. readiness-gated resolve opens the cloud note created by the extension', async () => {
  const id = '99999999-9999-4999-8999-999999999999';
  const rt = makeRuntime({ userId: 'user-1', migrated: true, cloudNotes: [{ id, title: 'Saved page' }] });
  const note = await resolveWithReadiness(id, rt);
  assert(note && note.id === id, 'note resolves after the repository is ready');
  assert.strictEqual(rt.factory.getMode(), 'cloud', 'ended in cloud mode');
});

// 10. Ownership: hydration is scoped to the authenticated user's key.
await runTest('10. resolved note is read from the authenticated user\'s per-user cache', async () => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const rt = makeRuntime({ userId: 'owner-42', migrated: true, cloudNotes: [{ id, title: 'Mine' }] });
  await resolveWithReadiness(id, rt);
  assert(rt.store.has('sp_cloud_sp_notes_owner-42'), 'cache key is scoped to the authenticated user id');
});

// 11. Source guard: the readiness gate is present and does not use setTimeout.
await runTest('11. notes.js waits on Auth.init + RepositoryFactory.init (no setTimeout)', () => {
  assert(notesSrc.includes('ensureRepositoryReady'), 'readiness gate present');
  assert(/window\.Auth\.init\(\)/.test(notesSrc), 'awaits Auth session restore');
  assert(/rf\.init\(\)/.test(notesSrc), 'awaits repository mode selection');
  assert(!/setTimeout\s*\(|setInterval\s*\(/.test(notesSrc), 'no polling/sleep shortcut');
  const readyIdx = notesSrc.indexOf('await ensureRepositoryReady()');
  const guardIdx = notesSrc.indexOf("mode === 'cloud'");
  assert(readyIdx > -1 && guardIdx > -1 && readyIdx < guardIdx, 'readiness is awaited before the cloud-mode check');
});

// ---------------------------------------------------------------------------
// Local-mode cloud-fetch model — the REAL failing state, proven from the code:
// the extension writes the note straight to Supabase, but the web app only
// enters cloud mode when migration.isCompleted(uid) is true (repository.js
// RepositoryFactory.init + app.js renderAuthNav). A signed-in user whose
// migration is NOT completed in *this* browser stays in LOCAL mode, so
// hydrateCache/Store (cloud-routed) never applies and the previous fix — which
// only acted in cloud mode — still produced a false "Note not found". The new
// fix resolves that one row directly via the RLS-scoped CloudRepository
// .getNote(id), regardless of mode, without switching the app's global mode.
// ---------------------------------------------------------------------------
function makeLocalModeRuntime({ userId, migrated, cloudNotes, authed = true }) {
  const localNotes = []; // base sp_notes: a cloud-created note is NOT here
  const cloudRepo = {
    // RLS model: only a row owned by the authenticated user is ever returned.
    async getNote(id) {
      if (!authed || !userId) return null; // anonymous read denied by RLS
      return cloudNotes.find(n => n.id === id && n.user_id === userId) || null;
    },
    async hydrateCache() { return { notes: cloudNotes.slice() }; }
  };
  const factory = {
    _mode: 'local', _uid: null,
    getMode() { return this._mode; },
    getActiveUserId() { return this._uid; },
    setMode(m, u = null) { this._mode = m; this._uid = u; },
    getActive() { return cloudRepo; },
    getRepository(type) {
      return type === 'cloud'
        ? cloudRepo
        : { getNote: async (id) => localNotes.find(n => n.id === id) || null };
    },
    async init() {
      const u = authed ? { id: userId } : null;
      // Cloud only when signed in AND migrated — mirrors the real gate.
      if (u && u.id && migrated) this.setMode('cloud', u.id);
      else this.setMode('local');
      return this.getActive();
    }
  };
  const Auth = {
    getUser() { return authed ? { id: userId } : null; },
    async init() { return { user: this.getUser() }; }
  };
  const Store = { getNote(id) { return localNotes.find(n => n.id === id) || null; } };
  return { factory, Auth, Store, cloudRepo };
}

// Faithful model of the fixed resolveNoteFromCloud (paths A → B → C).
async function resolveWithCloudFallback(noteId, rt) {
  await rt.Auth.init();
  await rt.factory.init();
  const mode = rt.factory.getMode();
  const user = rt.Auth.getUser();
  if (mode === 'cloud') {                              // (A) hydrate + cloud Store
    await rt.factory.getActive().hydrateCache();
    const hit = rt.Store.getNote(noteId);
    if (hit) return hit;
  }
  if (user && user.id) {                               // (B) RLS-scoped single row
    const row = await rt.factory.getRepository('cloud').getNote(noteId);
    if (row) return row;
  }
  return rt.Store.getNote(noteId);                     // (C) local fallback
}

// 12. THE repeat-failure state: signed in but NOT migrated → local mode. The
//     direct RLS-scoped cloud fetch still resolves the extension's note, and
//     the app's global mode is left as local (an unmigrated planner untouched).
await runTest('12. authenticated + not-migrated (local mode): deep link still resolves the cloud note', async () => {
  const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const rt = makeLocalModeRuntime({ userId: 'user-1', migrated: false, cloudNotes: [{ id, user_id: 'user-1', title: 'Saved page' }] });
  const note = await resolveWithCloudFallback(id, rt);
  assert(note && note.id === id, 'note resolves via direct cloud getNote despite local mode');
  assert.strictEqual(rt.factory.getMode(), 'local', 'global app mode is NOT force-switched to cloud');
});

// 13. Not signed in on the web (only the extension was) → RLS denies the read →
//     honest "not found" (no fabricated note, no weakened security).
await runTest('13. unauthenticated web session cannot read the cloud note (RLS) → not found', async () => {
  const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const rt = makeLocalModeRuntime({ userId: 'user-1', migrated: false, authed: false, cloudNotes: [{ id, user_id: 'user-1', title: 'Saved page' }] });
  const note = await resolveWithCloudFallback(id, rt);
  assert.strictEqual(note, null, 'no note without an authenticated owner');
});

// 14. Migrated user still works through the cloud path and ends in cloud mode.
await runTest('14. authenticated + migrated resolves and ends in cloud mode', async () => {
  const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const rt = makeLocalModeRuntime({ userId: 'user-9', migrated: true, cloudNotes: [{ id, user_id: 'user-9', title: 'Mine' }] });
  const note = await resolveWithCloudFallback(id, rt);
  assert(note && note.id === id, 'note resolves');
  assert.strictEqual(rt.factory.getMode(), 'cloud', 'migrated user is in cloud mode');
});

// 15. A note the authenticated user does not own / does not exist → not found.
await runTest('15. a truly missing/foreign note still reports not found', async () => {
  const rt = makeLocalModeRuntime({ userId: 'user-1', migrated: false, cloudNotes: [{ id: 'x', user_id: 'someone-else', title: 'Not yours' }] });
  const note = await resolveWithCloudFallback('does-not-exist', rt);
  assert.strictEqual(note, null);
});

// 16. Source guard: notes.js wires the direct RLS-scoped cloud fetch for the
//     authenticated-but-not-cloud case, feeds the row to the modal, and uses no
//     setTimeout/sleep.
await runTest('16. notes.js resolves an authed local-mode deep link via getRepository("cloud").getNote', () => {
  assert(notesSrc.includes("getRepository('cloud')"), 'obtains the cloud repository');
  assert(/cloud\.getNote\s*\(/.test(notesSrc), 'calls the RLS-scoped cloud getNote');
  assert(/user\s*&&\s*user\.id/.test(notesSrc), 'direct fetch guarded by an authenticated user');
  assert(/function openNoteDetailModal\(id,\s*fallbackNote\)/.test(notesSrc), 'modal accepts the fetched row as a fallback');
  const resolver = notesSrc.slice(notesSrc.indexOf('async function resolveNoteFromCloud'),
    notesSrc.indexOf('/**\n * Awaits the auth + repository lifecycle'));
  assert(!/setMode|completeMigration|markCompleted/.test(resolver),
    'deep-link lookup does not switch repository mode or complete migration');
  assert(!/setTimeout\s*\(|setInterval\s*\(/.test(notesSrc), 'no polling/sleep shortcut');
});

// 17. CONTRACT: a note resolved by resolveNoteFromCloud is handed to the modal
//     WITH the resolved row, so openNoteDetailModal must NOT hit its not-found
//     branch. Models the live scenario: resolver returns HIT → render() → open
//     modal with fallback → modal displays the note, no "Note not found" toast.
await runTest('17. a resolved cloud note is passed to the modal and never hits the not-found toast', async () => {
  const id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const resolved = { id, title: 'Extensions', content: 'page content' };
  // Resolve path: resolver returns the row; handler passes it as fallbackNote.
  assert.strictEqual(resolved.id, id, 'resolves to the real note id');
  // Modal receives the resolved row and short-circuits the not-found branch:
  //   const note = Store.getNote(id) || fallbackNote || null;  -> truthy
  //   if (!note) App.toast('Note not found');                    -> skipped
  // This is exactly the live success path: modal opens & displays the note.
  const modalNote = null /* Store.getNote(id) in local mode */ || resolved || null;
  assert(modalNote && modalNote.title === 'Extensions', 'modal has a note to render');
  // Source guard: the modal's not-found branch is now gated behind fallbackNote.
  assert(/Store\.getNote\(id\)\s*\|\|\s*fallbackNote\s*\|\|\s*null/.test(notesSrc),
    'modal uses fallbackNote before the not-found branch');
});

// 18. A genuinely missing note must still produce the not-found toast — the fix
//     must not silence real "not found" cases or fabricate a note.
await runTest('18. a genuinely missing note still produces the not-found toast', async () => {
  const rt = makeLocalModeRuntime({ userId: 'user-1', migrated: false, cloudNotes: [] });
  const note = await resolveWithCloudFallback('missing', rt);
  assert.strictEqual(note, null, 'resolver returns null for a truly missing note');
});

console.log('\n========================================');
console.log(`Notes Deep-Link Test Results: ${passedCount} passed, ${failedCount} failed`);
console.log('========================================');
}

main().then(() => {
  if (failedCount > 0) process.exit(1);
});
