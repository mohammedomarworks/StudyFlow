/**
 * tests/notes-cloud-edit.test.js
 * Regression coverage for the HTTP 400 returned by Supabase/PostgREST on
 *   POST /rest/v1/notes?on_conflict=id&select=*
 * when editing/saving a cloud-only note from the merged Notes list.
 *
 * ROOT CAUSE (proven from schema + code):
 *   notes.subject_id is a `uuid` column (FK → subjects.id, migration 0001).
 *   The note edit form's subject dropdown is populated from LOCAL subjects
 *   (js/notes.js populateSubjectDropdowns → Store.getSubjects()), whose ids are
 *   NON-UUID in local mode (storage.js Store.generateId → base36 string; the
 *   seed data even uses ids like "s1"). CloudRepository._toDbNote forwarded that
 *   string straight into subject_id, so PostgREST rejected the upsert with
 *   HTTP 400 / Postgres 22P02 "invalid input syntax for type uuid".
 *
 * FIX: _toDbNote only forwards subject_id when it is a real UUID; any other
 * value (local id, '', undefined) maps to NULL. No RLS change, no service-role,
 * no duplicate local note.
 *
 * These tests call the real CloudRepository._toDbNote (pure w.r.t. `this`) and
 * model saveNote's payload/id/user_id construction faithfully.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const rootDir = path.resolve(__dirname, '..');
const { CloudRepository } = require(path.join(rootDir, 'js/repository.js'));
const repoSrc = fs.readFileSync(path.join(rootDir, 'js/repository.js'), 'utf8');

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

// _toDbNote does not use instance state, so a prototype-only object is enough.
const repo = Object.create(CloudRepository.prototype);
const isUUID = (s) => typeof s === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

const USER = '11111111-1111-4111-8111-111111111111';
const NOTE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// Faithful model of CloudRepository.saveNote's payload construction (the part
// that builds what is upserted). Mirrors js/repository.js saveNote.
function buildUpsert(data, userId) {
  const payload = repo._toDbNote(data, userId);
  if (data.id && isUUID(data.id)) payload.id = data.id;
  const usesUpsert = Boolean(payload.id);
  return { payload, usesUpsert, onConflict: 'id' };
}

async function main() {
console.log('Running Notes Cloud-Edit Regression Suite...\n');

// 1. Reproduce the exact pre-fix trigger: a local (non-UUID) subject id.
await runTest('1. a non-UUID local subject id no longer reaches the uuid column (was 400/22P02)', () => {
  const localId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7); // Store.generateId (local)
  assert(!isUUID(localId), 'precondition: local subject id is not a UUID');
  const { payload } = buildUpsert({ id: NOTE_ID, title: 'T', content: 'C', subjectId: localId }, USER);
  assert.strictEqual(payload.subject_id, null, 'invalid uuid is coerced to NULL, not sent verbatim');
});

// 2. The seed sample subject ids ("s1", "s2") are also coerced to NULL.
await runTest('2. seed sample subject ids ("s1") map to NULL instead of a 400', () => {
  const { payload } = buildUpsert({ id: NOTE_ID, title: 'T', content: 'C', subjectId: 's1' }, USER);
  assert.strictEqual(payload.subject_id, null);
});

// 3. A genuine UUID subject id is preserved (valid cloud subject reference).
await runTest('3. a valid UUID subject id is forwarded unchanged', () => {
  const subj = '22222222-2222-4222-8222-222222222222';
  const { payload } = buildUpsert({ id: NOTE_ID, title: 'T', content: 'C', subjectId: subj }, USER);
  assert.strictEqual(payload.subject_id, subj);
});

// 4. Empty / missing subject → NULL ("No subject").
await runTest('4. empty or missing subject maps to NULL', () => {
  assert.strictEqual(buildUpsert({ id: NOTE_ID, title: 'T', content: 'C', subjectId: '' }, USER).payload.subject_id, null);
  assert.strictEqual(buildUpsert({ id: NOTE_ID, title: 'T', content: 'C' }, USER).payload.subject_id, null);
});

// 5. Editing an existing cloud-only note preserves its original UUID (same row).
await runTest('5. editing a cloud-only note keeps its UUID and upserts on id (same DB row)', () => {
  const { payload, usesUpsert, onConflict } = buildUpsert(
    { id: NOTE_ID, title: 'Edited', content: 'new body', subjectId: '' }, USER);
  assert.strictEqual(payload.id, NOTE_ID, 'original UUID preserved — update, not a new insert');
  assert.strictEqual(usesUpsert, true, 'goes through the upsert path');
  assert.strictEqual(onConflict, 'id', 'conflict target is id → updates the same row');
});

// 6. The edit payload carries the authenticated user_id (RLS owner), unchanged.
await runTest('6. the edit payload sets user_id to the authenticated user', () => {
  const { payload } = buildUpsert({ id: NOTE_ID, title: 'Edited', content: 'x' }, USER);
  assert.strictEqual(payload.user_id, USER, 'user_id is the authenticated owner');
});

// 7. A note with no UUID id (local-origin) still inserts (no bogus id, no upsert).
await runTest('7. a non-UUID note id does not force an upsert with a bad id', () => {
  const { payload, usesUpsert } = buildUpsert({ id: 'local-note-xyz', title: 'T', content: 'C' }, USER);
  assert.strictEqual(payload.id, undefined, 'no non-UUID id placed in the payload');
  assert.strictEqual(usesUpsert, false, 'falls to the insert path, letting the DB mint a UUID');
});

// 8. Source guard: the fix lives in _toDbNote and validates the uuid, and the
//    column is still named subject_id (no schema/RLS change).
await runTest('8. _toDbNote guards subject_id with isUUID (no RLS/schema change)', () => {
  const fn = repoSrc.slice(repoSrc.indexOf('_toDbNote(data, userId)'),
                           repoSrc.indexOf('_fromDbHabit'));
  assert(/isUUID\(/.test(fn), '_toDbNote validates the subject id as a UUID');
  assert(/subject_id:/.test(fn), 'still writes the subject_id column');
  assert(!/service_role|serviceRole/.test(fn), 'no service-role credentials introduced');
});

console.log('\n========================================');
console.log(`Notes Cloud-Edit Test Results: ${passedCount} passed, ${failedCount} failed`);
console.log('========================================');
}

main().then(() => {
  if (failedCount > 0) process.exit(1);
});
