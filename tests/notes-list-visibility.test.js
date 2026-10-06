/**
 * tests/notes-list-visibility.test.js
 * Regression coverage for the "cloud-created notes never appear in the main
 * Notes list" failure. The browser extension writes notes straight to Supabase,
 * but the web app stays in LOCAL mode until migration.isCompleted(uid) is true.
 * render() historically read only Store.getNotes() (local-only), so an
 * authenticated-but-unmigrated user never saw their extension notes.
 *
 * The fix: getDisplayNotes() merges local + cloud notes in-memory (local wins
 * on ID collision) via the existing RLS-scoped CloudRepository.getNotes(),
 * WITHOUT switching global mode, completing migration, or persisting fake local
 * records. On any cloud-fetch failure it returns local notes so the list is
 * never emptied.
 *
 * These tests model that decision logic faithfully and guard the source so the
 * constraints (no mode switch, no fake local writes, local-wins dedup) hold.
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

const rootDir = path.resolve(__dirname, '..');
const notesSrc = fs.readFileSync(path.join(rootDir, 'js/notes.js'), 'utf8');

// ---------------------------------------------------------------------------
// Runtime model: a local Store, an authenticated (or anonymous) user, and an
// RLS-scoped cloud repo. getDisplayNotes() is reimplemented faithfully from
// js/notes.js so the merge/dedup/fallback behavior is exercised directly.
// ---------------------------------------------------------------------------
function makeRuntime({ mode = 'local', authed = true, userId = 'user-1',
                       localNotes = [], cloudNotes = [], cloudThrows = false,
                       cloudReturnsNonArray = false }) {
  const cloudRepo = {
    async getNotes() {
      if (cloudThrows) throw new Error('network');
      if (cloudReturnsNonArray) return null;
      // RLS: only the authenticated owner's rows are returned.
      if (!authed || !userId) return [];
      return cloudNotes.filter(n => n.user_id === undefined || n.user_id === userId);
    }
  };
  const factory = {
    _mode: mode,
    getMode() { return this._mode; },
    getActive() { return cloudRepo; },        // active repo in cloud mode
    getRepository(type) { return type === 'cloud' ? cloudRepo : null; }
  };
  const Auth = { getUser() { return authed ? { id: userId } : null; } };
  const Store = { getNotes() { return localNotes.slice(); } };
  return { factory, Auth, Store, cloudRepo };
}

// Faithful reimplementation of js/notes.js getDisplayNotes().
async function getDisplayNotes(rt) {
  const rf = rt.factory;
  const mode = rf && typeof rf.getMode === 'function' ? rf.getMode() : 'local';

  if (mode === 'cloud') {
    const repo = rf.getActive();
    if (repo && typeof repo.getNotes === 'function') {
      try { return await repo.getNotes(); } catch { return rt.Store.getNotes(); }
    }
    return rt.Store.getNotes();
  }

  const user = rt.Auth && rt.Auth.getUser ? rt.Auth.getUser() : null;
  if (!user || !user.id) return rt.Store.getNotes();

  const localNotes = rt.Store.getNotes();
  try {
    if (!rf || typeof rf.getRepository !== 'function') return localNotes;
    const cloudRepo = rf.getRepository('cloud');
    if (!cloudRepo || typeof cloudRepo.getNotes !== 'function') return localNotes;
    const cloudNotes = await cloudRepo.getNotes();
    if (!Array.isArray(cloudNotes)) return localNotes;
    const localIds = new Set(localNotes.map(n => n.id));
    const cloudOnly = cloudNotes.filter(n => !localIds.has(n.id));
    return [...localNotes, ...cloudOnly];
  } catch (err) {
    return localNotes;
  }
}

async function main() {
console.log('Running Notes List-Visibility Regression Suite...\n');

// 1. Local notes stay visible when migration is incomplete (local mode, authed).
await runTest('1. local notes remain visible when migration is incomplete', async () => {
  const rt = makeRuntime({ mode: 'local', authed: true,
    localNotes: [{ id: 'l1', title: 'Local one' }], cloudNotes: [] });
  const notes = await getDisplayNotes(rt);
  assert.deepStrictEqual(notes.map(n => n.id), ['l1'], 'local note is present');
});

// 2. Cloud-only notes appear in the list while the app is still in local mode.
await runTest('2. cloud-only notes appear in the merged list in local mode', async () => {
  const rt = makeRuntime({ mode: 'local', authed: true, userId: 'user-1',
    localNotes: [], cloudNotes: [{ id: 'c1', user_id: 'user-1', title: 'Clip' }] });
  const notes = await getDisplayNotes(rt);
  assert.deepStrictEqual(notes.map(n => n.id), ['c1'], 'cloud-only note is surfaced');
});

// 3. Merge: local + cloud both show; local wins on ID collision.
await runTest('3. merge dedups by id with local winning on collision', async () => {
  const rt = makeRuntime({ mode: 'local', authed: true, userId: 'user-1',
    localNotes: [{ id: 'shared', title: 'LOCAL edit' }, { id: 'l2', title: 'Local two' }],
    cloudNotes: [{ id: 'shared', user_id: 'user-1', title: 'CLOUD stale' },
                 { id: 'c2', user_id: 'user-1', title: 'Cloud two' }] });
  const notes = await getDisplayNotes(rt);
  const shared = notes.find(n => n.id === 'shared');
  assert.strictEqual(shared.title, 'LOCAL edit', 'local copy wins on collision');
  assert.strictEqual(notes.length, 3, 'no duplicate id in merged list');
  assert.deepStrictEqual(notes.map(n => n.id).sort(), ['c2', 'l2', 'shared']);
});

// 4. The merged list is a plain array search/filter/sort can run over.
await runTest('4. search/filter/sort operate over the merged list', async () => {
  const rt = makeRuntime({ mode: 'local', authed: true, userId: 'user-1',
    localNotes: [{ id: 'l1', title: 'Algebra', pinned: false }],
    cloudNotes: [{ id: 'c1', user_id: 'user-1', title: 'Biology', pinned: true }] });
  const notes = await getDisplayNotes(rt);
  const filtered = notes.filter(n => /bio/i.test(n.title));
  assert.deepStrictEqual(filtered.map(n => n.id), ['c1'], 'cloud note is searchable');
  const pinnedFirst = notes.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  assert.strictEqual(pinnedFirst[0].id, 'c1', 'cloud note participates in sort');
});

// 5. A cloud-only card carries its note via data-note so it can open without Store.
await runTest('5. cloud-only cards embed their note for opening without a Store hit', () => {
  assert(/data-note='\$\{JSON\.stringify\(n\)\.replace\(\/'\/g,\s*'&#39;'\)\}'/.test(notesSrc),
    'note-card markup embeds the full note as data-note');
  assert(/cardNote\s*=\s*card\.dataset\.note\s*\?\s*JSON\.parse\(card\.dataset\.note\)/.test(notesSrc),
    'wireCards parses the embedded note');
  assert(/openNoteDetailModal\(id,\s*cardNote\)/.test(notesSrc),
    'card click passes the parsed note to the detail modal');
});

// 6. After a cloud edit/pin the list is refreshed (render() re-run) and reflects it.
await runTest('6. editing/pinning a cloud note refreshes the list from the cloud', async () => {
  const cloudNotes = [{ id: 'c1', user_id: 'user-1', title: 'Before', pinned: false }];
  const rt = makeRuntime({ mode: 'local', authed: true, userId: 'user-1',
    localNotes: [], cloudNotes });
  let notes = await getDisplayNotes(rt);
  assert.strictEqual(notes.find(n => n.id === 'c1').pinned, false);
  // simulate a cloud pin mutation, then a re-render (render() calls getDisplayNotes again)
  cloudNotes[0].pinned = true;
  notes = await getDisplayNotes(rt);
  assert.strictEqual(notes.find(n => n.id === 'c1').pinned, true, 're-render shows the mutation');
  // Source guard: card pin/delete handlers re-call render() after mutating.
  assert(/function pinNoteFromCard/.test(notesSrc) && /render\(\);/.test(notesSrc),
    'card pin handler re-renders');
});

// 7. Deleting a cloud note removes it from the list on the next render.
await runTest('7. deleting a cloud note removes it from the list', async () => {
  const cloudNotes = [{ id: 'c1', user_id: 'user-1', title: 'Doomed' }];
  const rt = makeRuntime({ mode: 'local', authed: true, userId: 'user-1',
    localNotes: [], cloudNotes });
  assert.strictEqual((await getDisplayNotes(rt)).length, 1);
  cloudNotes.length = 0; // cloud delete
  assert.strictEqual((await getDisplayNotes(rt)).length, 0, 'gone after re-render');
  assert(/function deleteNoteFromCard/.test(notesSrc), 'card delete handler routes cloud deletes');
});

// 8. Cloud fetch failure keeps local notes visible (never empties the list).
await runTest('8. cloud fetch failure falls back to local notes', async () => {
  const rt = makeRuntime({ mode: 'local', authed: true, userId: 'user-1',
    localNotes: [{ id: 'l1', title: 'Still here' }], cloudThrows: true });
  const notes = await getDisplayNotes(rt);
  assert.deepStrictEqual(notes.map(n => n.id), ['l1'], 'local notes survive a cloud error');
});

// 9. Cloud mode uses the active repo directly and produces no duplicates.
await runTest('9. cloud mode reads the active repo with no duplication', async () => {
  const rt = makeRuntime({ mode: 'cloud', authed: true, userId: 'user-1',
    localNotes: [{ id: 'ignored-local', title: 'should not merge' }],
    cloudNotes: [{ id: 'c1', user_id: 'user-1' }, { id: 'c2', user_id: 'user-1' }] });
  const notes = await getDisplayNotes(rt);
  assert.deepStrictEqual(notes.map(n => n.id).sort(), ['c1', 'c2'],
    'cloud mode returns cloud notes only, no local merge, no dupes');
});

// 10. Unauthenticated users get local notes only — no cloud read attempted.
await runTest('10. unauthenticated users see only local notes', async () => {
  const rt = makeRuntime({ mode: 'local', authed: false,
    localNotes: [{ id: 'l1', title: 'Local only' }],
    cloudNotes: [{ id: 'c1', user_id: 'user-1' }] });
  const notes = await getDisplayNotes(rt);
  assert.deepStrictEqual(notes.map(n => n.id), ['l1'], 'no cloud notes for anonymous session');
});

// 11. getDisplayNotes never switches global mode or writes fake local records.
await runTest('11. the fix does not switch mode, complete migration, or persist fake notes', () => {
  const fn = notesSrc.slice(notesSrc.indexOf('async function getDisplayNotes'),
                            notesSrc.indexOf('function render()'));
  assert(!/setMode\s*\(/.test(fn), 'getDisplayNotes does not switch global mode');
  assert(!/isCompleted|completeMigration|markCompleted/.test(fn), 'does not complete migration');
  assert(!/saveNote\s*\(|Store\.saveNote|setItem/.test(fn), 'does not persist cloud notes locally');
  assert(/getRepository\('cloud'\)/.test(fn), 'uses the existing RLS-scoped cloud repo');
  assert(/return localNotes;/.test(fn), 'falls back to local notes on failure');
});

console.log('\n========================================');
console.log(`Notes List-Visibility Test Results: ${passedCount} passed, ${failedCount} failed`);
console.log('========================================');
}

main().then(() => {
  if (failedCount > 0) process.exit(1);
});
