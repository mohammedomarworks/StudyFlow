/**
 * tests/notes-subject-mapping.test.js
 * Regression test suite for StudyFlow v2.1:
 * Subject selection & mapping for cloud-only and local notes.
 *
 * Covers all subject mapping and save requirements:
 * 1. local note + local subject
 * 2. cloud note + UUID subject
 * 3. cloud-only note + subject selection (mapping local subject to cloud UUID)
 * 4. cloud-only note + no subject
 * 5. non-UUID local subject ID is never sent directly to notes.subject_id
 * 6. subject_id saved to Supabase is a real UUID when a cloud subject is selected
 * 7. reopening the note preserves the subject relationship
 * 8. missing subject does not break note saving
 * 9. existing Notes list merge behavior remains unchanged
 * 10. End-to-End: normal website note in local mode never routes to cloud and preserves subject
 * 11. End-to-End: cloud-only note in local mode routes to cloud repo and maps local subject to cloud UUID
 * 12. End-to-End: website note in cloud mode uses cloud repository and UUID
 * 13. Duplicate-name safety: unmapped local subject never attaches to unrelated existing cloud subject with the same name, provisions a new cloud subject, and stores mapping
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const rootDir = path.resolve(__dirname, '..');
const { CloudRepository, LocalRepository, RepositoryFactory } = require(path.join(rootDir, 'js/repository.js'));
const notesSrc = fs.readFileSync(path.join(rootDir, 'js/notes.js'), 'utf8');

// Load notes module (it exports functions in Node)
// Mock minimal browser globals needed by notes module
global.window = global;
global.localStorage = {
  _store: {},
  getItem(k) { return this._store[k] || null; },
  setItem(k, v) { this._store[k] = String(v); },
  removeItem(k) { delete this._store[k]; },
  clear() { this._store = {}; }
};

const Notes = require(path.join(rootDir, 'js/notes.js'));

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

const isUUID = Notes.isUUID;
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLOUD_NOTE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CLOUD_SUBJ_UUID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function createDOMSelect() {
  const select = {
    _innerHTML: '',
    _value: '',
    options: [],
    get innerHTML() { return this._innerHTML; },
    set innerHTML(html) {
      this._innerHTML = html;
      this.options = [];
      const optionRegex = /<option\s+value="([^"]*)"[^>]*>(.*?)<\/option>/gi;
      let match;
      while ((match = optionRegex.exec(html)) !== null) {
        this.options.push({
          value: match[1],
          text: match[2],
          textContent: match[2]
        });
      }
      const matching = this.options.find(o => o.value === this._value);
      this.value = matching ? this._value : (this.options[0] ? this.options[0].value : '');
    },
    get value() { return this._value; },
    set value(val) {
      this._value = val;
      const opt = this.options.find(o => o.value === val);
      this.selectedOptions = opt ? [opt] : (this.options[0] ? [this.options[0]] : []);
      this.selectedIndex = opt ? this.options.indexOf(opt) : (this.options.length ? 0 : -1);
    },
    selectedOptions: [],
    selectedIndex: 0
  };
  return select;
}

// Mock Auth
const AuthMock = {
  _user: { id: USER_ID },
  getUser() { return this._user; }
};
global.Auth = AuthMock;

// Mock Store
const StoreMock = {
  _subjects: [
    { id: 's1', name: 'Mathematics', color: '#3b82f6', teacher: 'Prof. Gauss' },
    { id: 's2', name: 'Physics', color: '#10b981', teacher: 'Prof. Newton' }
  ],
  _notes: [
    { id: 'local-note-1', title: 'Local Note', content: 'Local content', subjectId: 's1', pinned: false }
  ],
  getSubjects() { return this._subjects.slice(); },
  getSubject(id) { return this._subjects.find(s => s.id === id) || null; },
  getNotes() { return this._notes.slice(); },
  getNote(id) { return this._notes.find(n => n.id === id) || null; },
  saveNote(data) {
    const i = this._notes.findIndex(n => n.id === data.id);
    if (i > -1) {
      this._notes[i] = { ...this._notes[i], ...data };
    } else {
      this._notes.push({ ...data, id: data.id || 'local-' + Date.now() });
    }
    return data;
  }
};
global.Store = StoreMock;

// Mock Cloud Repo
function createMockCloudRepo() {
  const dbSubjects = [
    { id: CLOUD_SUBJ_UUID, user_id: USER_ID, name: 'Chemistry', color: '#f59e0b' }
  ];
  const dbNotes = [
    { id: CLOUD_NOTE_ID, user_id: USER_ID, title: 'Extension Clip', content: 'Clipped text', subject_id: null, pinned: false }
  ];

  return {
    _dbSubjects: dbSubjects,
    _dbNotes: dbNotes,
    async getSubjects() {
      return this._dbSubjects.map(s => ({
        id: s.id,
        name: s.name,
        color: s.color,
        userId: s.user_id
      }));
    },
    async saveSubject(data) {
      const id = (data.id && isUUID(data.id)) ? data.id : 'dddddddd-dddd-4ddd-dddd-dddddddddddd';
      const row = {
        id,
        user_id: USER_ID,
        name: data.name || 'Untitled Subject',
        color: data.color || '#7c3aed',
        teacher: data.teacher || null,
        code: data.code || null,
        exam_date: data.examDate || null
      };
      this._dbSubjects.push(row);
      return { id: row.id, name: row.name, color: row.color, userId: row.user_id };
    },
    async getNote(id) {
      const n = this._dbNotes.find(r => r.id === id);
      if (!n) return null;
      return {
        id: n.id,
        title: n.title,
        content: n.content,
        subjectId: n.subject_id || '',
        pinned: n.pinned
      };
    },
    async saveNote(data) {
      const repoProto = Object.create(CloudRepository.prototype);
      const dbRow = repoProto._toDbNote(data, USER_ID);
      if (data.id && isUUID(data.id)) dbRow.id = data.id;

      const i = this._dbNotes.findIndex(n => n.id === data.id);
      if (i > -1) {
        this._dbNotes[i] = { ...this._dbNotes[i], ...dbRow };
      } else {
        this._dbNotes.push({ ...dbRow, id: dbRow.id || 'generated-uuid-note' });
      }

      return {
        id: dbRow.id || data.id,
        title: dbRow.title,
        content: dbRow.content,
        subjectId: dbRow.subject_id || '',
        pinned: dbRow.pinned
      };
    }
  };
}

async function main() {
  console.log('Running Notes Subject-Mapping Regression Suite...\n');

  // Setup repo factory
  const mockCloud = createMockCloudRepo();
  RepositoryFactory._mode = 'local';
  RepositoryFactory._activeUserId = USER_ID;
  RepositoryFactory.getRepository = function(type) {
    if (type === 'cloud') return mockCloud;
    return new LocalRepository(StoreMock);
  };
  global.StudyFlowRepository = { RepositoryFactory };

  // 1. local note + local subject
  await runTest('1. local note + local subject: local mode saves to local Store, preserves local subject ID', () => {
    const localNote = StoreMock.getNote('local-note-1');
    assert(localNote, 'local note exists in Store');
    assert.strictEqual(Notes.isCloudNote(localNote), false, 'isCloudNote is false for local note');

    const repo = Notes.repoForActiveNote(localNote);
    assert.strictEqual(repo, null, 'local note routes to local store (repo is null)');

    // Save with local subject 's2'
    StoreMock.saveNote({ id: 'local-note-1', subjectId: 's2', title: 'Local Note', content: 'Local content' });
    const updated = StoreMock.getNote('local-note-1');
    assert.strictEqual(updated.subjectId, 's2', 'local subject ID s2 preserved in Store');
  });

  // 2. cloud note + UUID subject
  await runTest('2. cloud note + UUID subject: preserves valid cloud UUID subject directly', async () => {
    const cloudNote = { id: CLOUD_NOTE_ID, title: 'Cloud Note', subjectId: CLOUD_SUBJ_UUID };
    assert.strictEqual(Notes.isCloudNote(cloudNote), true, 'isCloudNote is true for UUID note id');

    const resolvedSubjectId = await Notes.resolveCloudSubjectId(CLOUD_SUBJ_UUID);
    assert.strictEqual(resolvedSubjectId, CLOUD_SUBJ_UUID, 'valid UUID returns unchanged');

    const saved = await mockCloud.saveNote({ id: CLOUD_NOTE_ID, subjectId: resolvedSubjectId, title: 'T', content: 'C' });
    assert.strictEqual(saved.subjectId, CLOUD_SUBJ_UUID, 'saved note has cloud subject UUID');

    const dbRow = mockCloud._dbNotes.find(n => n.id === CLOUD_NOTE_ID);
    assert.strictEqual(dbRow.subject_id, CLOUD_SUBJ_UUID, 'db row subject_id is UUID');
  });

  // 3. cloud-only note + subject selection (mapping local subject to cloud UUID)
  await runTest('3. cloud-only note + subject selection: maps local subject to real cloud UUID through CloudRepository', async () => {
    // Note is cloud-only, user selects local subject 's1' (Mathematics)
    localStorage.clear();
    const resolvedUuid = await Notes.resolveCloudSubjectId('s1');
    assert(isUUID(resolvedUuid), 'resolved ID must be a valid UUID');

    // Check that cloudRepo.saveSubject was called and added the subject
    const cloudSubj = mockCloud._dbSubjects.find(s => s.id === resolvedUuid);
    assert(cloudSubj, 'cloud subject created in CloudRepository');
    assert.strictEqual(cloudSubj.name, 'Mathematics', 'subject name matches local subject');

    // Check that mapping was stored in sp_migration_map_${userId}
    const idMapRaw = localStorage.getItem(`sp_migration_map_${USER_ID}`);
    assert(idMapRaw, 'migration map persisted to localStorage');
    const idMap = JSON.parse(idMapRaw);
    assert.strictEqual(idMap.subjects['s1'], resolvedUuid, 'map maps s1 to the new UUID');

    // Second resolution must reuse the same UUID without duplicating
    const countBefore = mockCloud._dbSubjects.length;
    const resolvedAgain = await Notes.resolveCloudSubjectId('s1');
    assert.strictEqual(resolvedAgain, resolvedUuid, 'subsequent lookup returns cached UUID');
    assert.strictEqual(mockCloud._dbSubjects.length, countBefore, 'did not create duplicate cloud subject');
  });

  // 4. cloud-only note + no subject
  await runTest('4. cloud-only note + no subject: maps to null and saves subject_id = null', async () => {
    const resolvedEmpty = await Notes.resolveCloudSubjectId('');
    assert.strictEqual(resolvedEmpty, null, 'empty string maps to null');

    const resolvedNull = await Notes.resolveCloudSubjectId(null);
    assert.strictEqual(resolvedNull, null, 'null maps to null');

    const saved = await mockCloud.saveNote({ id: CLOUD_NOTE_ID, subjectId: resolvedEmpty, title: 'T', content: 'C' });
    assert.strictEqual(saved.subjectId, '', 'saved note model has empty subjectId');

    const dbRow = mockCloud._dbNotes.find(n => n.id === CLOUD_NOTE_ID);
    assert.strictEqual(dbRow.subject_id, null, 'db row has subject_id = null');
  });

  // 5. non-UUID local subject ID is never sent directly to notes.subject_id
  await runTest('5. non-UUID local subject ID is never sent directly to notes.subject_id', () => {
    const repoProto = Object.create(CloudRepository.prototype);

    // Direct _toDbNote calls with various non-UUID inputs
    const p1 = repoProto._toDbNote({ subjectId: 's1' }, USER_ID);
    assert.strictEqual(p1.subject_id, null, 'local id "s1" becomes null');

    const p2 = repoProto._toDbNote({ subjectId: 'mupjxnjyy3f4m' }, USER_ID);
    assert.strictEqual(p2.subject_id, null, 'base36 local id becomes null');

    const p3 = repoProto._toDbNote({ subjectId: 'invalid-non-uuid' }, USER_ID);
    assert.strictEqual(p3.subject_id, null, 'arbitrary string becomes null');

    // Source verification: check _toDbNote guards with isUUID
    const repoSrc = fs.readFileSync(path.join(rootDir, 'js/repository.js'), 'utf8');
    assert(repoSrc.includes('isUUID(rawSubject) ? rawSubject : null'), 'repository guards subject_id with isUUID');
  });

  // 6. subject_id saved to Supabase is a real UUID when a cloud subject is selected
  await runTest('6. subject_id saved to Supabase is a real UUID when a cloud subject is selected', async () => {
    // Select local subject 's2' (Physics) for cloud note
    const resolvedUuid = await Notes.resolveCloudSubjectId('s2');
    assert(isUUID(resolvedUuid), 'resolved subject ID is a UUID');

    const saved = await mockCloud.saveNote({
      id: CLOUD_NOTE_ID,
      title: 'Note for Physics',
      content: 'Formula content',
      subjectId: resolvedUuid
    });

    assert(isUUID(saved.subjectId), 'returned note has UUID subjectId');
    const dbRow = mockCloud._dbNotes.find(n => n.id === CLOUD_NOTE_ID);
    assert(isUUID(dbRow.subject_id), 'PostgreSQL subject_id column receives real UUID');
    assert.strictEqual(dbRow.subject_id, resolvedUuid, 'matches resolved UUID exactly');
  });

  // 7. reopening the note preserves the subject relationship
  await runTest('7. reopening the note preserves the subject relationship across modal, detail, and cards', async () => {
    const resolvedUuid = await Notes.resolveCloudSubjectId('s1');

    // Test resolveSubjectForDisplay: finds subject entity from UUID
    const subjEntity = Notes.resolveSubjectForDisplay(resolvedUuid);
    assert(subjEntity, 'resolveSubjectForDisplay finds mapped subject');
    assert.strictEqual(subjEntity.name, 'Mathematics', 'name matches Mathematics');

    // Test populateNoteModalSubjects: builds dropdown with cloud subject UUID
    const formSelect = createDOMSelect();
    global.App = {
      qs: (sel) => (sel === '#noteSubject' ? formSelect : null),
      escapeHtml: (str) => String(str)
    };

    Notes.populateNoteModalSubjects(true, resolvedUuid);
    assert(formSelect.options.length > 1, 'options.length > 1 after populateNoteModalSubjects');
    assert(formSelect.options.some(o => o.value === resolvedUuid), 'dropdown contains option with cloud UUID');
    assert.strictEqual(formSelect.value, resolvedUuid, 'form select sets value to the saved subject UUID');
  });

  // 8. missing subject does not break note saving
  await runTest('8. missing subject does not break note saving', async () => {
    // Non-existent subject ID
    const resolved = await Notes.resolveCloudSubjectId('deleted-nonexistent-subj-999');
    assert.strictEqual(resolved, null, 'missing subject resolves to null');

    // Saving note with null subject succeeds cleanly
    const saved = await mockCloud.saveNote({
      id: CLOUD_NOTE_ID,
      title: 'Orphan Note',
      content: 'Content',
      subjectId: resolved
    });
    assert.strictEqual(saved.title, 'Orphan Note');
    assert.strictEqual(saved.subjectId, '');
  });

  // 9. existing Notes list merge behavior remains unchanged
  await runTest('9. existing Notes list merge behavior remains unchanged', async () => {
    // Verify source guards from notes-list-visibility
    assert(notesSrc.includes('getDisplayNotes'), 'getDisplayNotes function exists');
    assert(notesSrc.includes('localIds = new Set(localNotes.map(n => n.id))'), 'dedup logic preserved');
    assert(notesSrc.includes('cloudOnly = cloudNotes.filter(n => !localIds.has(n.id))'), 'cloudOnly append preserved');
    assert(notesSrc.includes('resolveNoteFromCloud'), 'resolveNoteFromCloud preserved');
    assert(notesSrc.includes('view.activeDetailNote'), 'view.activeDetailNote retained');
  });

  // 10. End-to-End: normal website note in local mode never routes to cloud and preserves subject
  await runTest('10. End-to-End: normal website note in local mode never routes to cloud and preserves subject', async () => {
    RepositoryFactory._mode = 'local';
    // Even if view.activeDetailNote previously held a cloud note!
    Notes.view.activeDetailNote = { id: CLOUD_NOTE_ID, title: 'Previous Cloud Note', subjectId: CLOUD_SUBJ_UUID };
    Notes.view.activeDetailId = CLOUD_NOTE_ID;

    // Simulate clicking "+ New Note"
    const formFields = {
      '#noteTitle': { value: 'Biology Revision Notes' },
      '#noteContent': { value: 'Cell mitosis and meiosis' },
      '#noteId': { value: '' },
      '#noteSubject': {
        value: 's1',
        selectedOptions: [{ textContent: 'Mathematics' }],
        options: [{ value: '', text: '— No subject —' }, { value: 's1', text: 'Mathematics' }]
      },
      '#notePinned': { checked: false }
    };

    global.App = {
      qs: (sel) => formFields[sel] || null,
      qsa: () => [],
      escapeHtml: (s) => String(s),
      toast: () => {},
      openModal: () => {},
      closeModal: () => {}
    };

    // Before submit, repo for new note MUST be null (local Store)
    const newNoteRepo = Notes.repoForActiveNote(null);
    assert.strictEqual(newNoteRepo, null, 'new note in local mode must NOT route to cloudRepo');

    // Run submit
    await Notes.handleSubmitNote({ preventDefault: () => {} });

    // Verify saved note exists in local Store with subjectId = 's1'
    const notesInStore = StoreMock.getNotes();
    const created = notesInStore.find(n => n.title === 'Biology Revision Notes');
    assert(created, 'note was created in local Store');
    assert.strictEqual(created.subjectId, 's1', 'note in local Store retained local subjectId "s1"');

    // Verify it was NOT added to cloud repo
    const cloudMatch = mockCloud._dbNotes.find(n => n.title === 'Biology Revision Notes');
    assert.strictEqual(cloudMatch, undefined, 'local note must NOT be persisted to Supabase');

    // Verify display resolution
    const displaySubj = Notes.resolveSubjectForDisplay(created.subjectId);
    assert(displaySubj, 'subject resolves for display');
    assert.strictEqual(displaySubj.name, 'Mathematics');

    // Verify editing restores the subject in the dropdown
    Notes.openNoteModal(created.id);
    assert.strictEqual(formFields['#noteSubject'].value, 's1', 'editing note restores subject value in dropdown');
  });

  // 11. End-to-End: cloud-only note in local mode routes to cloud repo and maps local subject to cloud UUID
  await runTest('11. End-to-End: cloud-only note in local mode routes to cloud repo and maps local subject to cloud UUID', async () => {
    RepositoryFactory._mode = 'local';
    const EXT_NOTE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    mockCloud._dbNotes.push({
      id: EXT_NOTE_ID,
      user_id: USER_ID,
      title: 'Extension Clipping',
      content: 'Important web research',
      subject_id: null,
      pinned: false
    });

    const formFields = {
      '#noteTitle': { value: 'Extension Clipping' },
      '#noteContent': { value: 'Important web research' },
      '#noteId': { value: EXT_NOTE_ID },
      '#noteSubject': {
        value: 's2', // local subject "Physics"
        selectedOptions: [{ textContent: 'Physics' }],
        options: [{ value: '', text: '— No subject —' }, { value: 's2', text: 'Physics' }]
      },
      '#notePinned': { checked: false }
    };

    global.App = {
      qs: (sel) => formFields[sel] || null,
      qsa: () => [],
      escapeHtml: (s) => String(s),
      toast: () => {},
      openModal: () => {},
      closeModal: () => {}
    };

    const targetNote = { id: EXT_NOTE_ID, title: 'Extension Clipping' };
    const repo = Notes.repoForActiveNote(targetNote);
    assert(repo, 'cloud note routes to cloudRepo');
    assert.strictEqual(repo, mockCloud, 'routes to mockCloud');

    // Run submit
    await Notes.handleSubmitNote({ preventDefault: () => {} });

    // Verify cloud note updated in Supabase with real UUID
    const updatedCloud = mockCloud._dbNotes.find(n => n.id === EXT_NOTE_ID);
    assert(updatedCloud, 'cloud note updated in mockCloud');
    assert(isUUID(updatedCloud.subject_id), 'subject_id in Supabase is a valid UUID');

    // Verify display resolution matches the subject
    const subjEntity = Notes.resolveSubjectForDisplay(updatedCloud.subject_id);
    assert(subjEntity, 'display resolves the mapped cloud subject');
    assert.strictEqual(subjEntity.name, 'Physics', 'subject name matches Physics');
  });

  // 12. End-to-End: website note in cloud mode uses cloud repository and UUID
  await runTest('12. End-to-End: website note in cloud mode uses cloud repository and UUID', async () => {
    RepositoryFactory._mode = 'cloud';

    const formFields = {
      '#noteTitle': { value: 'Cloud Architecture Notes' },
      '#noteContent': { value: 'Database normalization and sharding' },
      '#noteId': { value: '' },
      '#noteSubject': {
        value: CLOUD_SUBJ_UUID,
        selectedOptions: [{ textContent: 'Chemistry' }],
        options: [{ value: '', text: '— No subject —' }, { value: CLOUD_SUBJ_UUID, text: 'Chemistry' }]
      },
      '#notePinned': { checked: true }
    };

    global.App = {
      qs: (sel) => formFields[sel] || null,
      qsa: () => [],
      escapeHtml: (s) => String(s),
      toast: () => {},
      openModal: () => {},
      closeModal: () => {}
    };

    const newNoteRepo = Notes.repoForActiveNote(null);
    assert.strictEqual(newNoteRepo, mockCloud, 'in cloud mode, new notes route to cloud repo');

    // Run submit
    await Notes.handleSubmitNote({ preventDefault: () => {} });

    // Verify note created in cloud repo with the UUID
    const cloudNote = mockCloud._dbNotes.find(n => n.title === 'Cloud Architecture Notes');
    assert(cloudNote, 'note saved to CloudRepository');
    assert.strictEqual(cloudNote.subject_id, CLOUD_SUBJ_UUID, 'subject_id is the selected cloud UUID');
    assert.strictEqual(cloudNote.pinned, true, 'pinned property preserved');

    // Reset mode back to local for test hygiene
    RepositoryFactory._mode = 'local';
  });

  // 13. Duplicate-name safety: unmapped local subject never attaches to unrelated existing cloud subject with the same name, provisions a new cloud subject, and stores mapping
  await runTest('13. Duplicate-name safety: unmapped local subject never attaches to unrelated existing cloud subject with the same name, provisions a new cloud subject, and stores mapping', async () => {
    // 1. Setup local subject 's3' named 'Literature'
    StoreMock._subjects.push({
      id: 's3',
      name: 'Literature',
      color: '#ec4899',
      teacher: 'Prof. Shakespeare'
    });

    // 2. Setup existing unrelated cloud subject that happens to have the exact same name 'Literature'
    const EXISTING_UNRELATED_CLOUD_UUID = '11111111-1111-4111-8111-111111111111';
    mockCloud._dbSubjects.push({
      id: EXISTING_UNRELATED_CLOUD_UUID,
      user_id: USER_ID,
      name: 'Literature',
      color: '#8b5cf6'
    });

    // Ensure migration map has no entry for 's3'
    const idMapRaw = localStorage.getItem(`sp_migration_map_${USER_ID}`);
    const idMap = idMapRaw ? JSON.parse(idMapRaw) : { subjects: {}, notes: {} };
    if (idMap.subjects) delete idMap.subjects['s3'];
    localStorage.setItem(`sp_migration_map_${USER_ID}`, JSON.stringify(idMap));

    const cloudSubjectsCountBefore = mockCloud._dbSubjects.length;

    // 3. Resolve cloud subject for 's3'
    const resolvedUuid = await Notes.resolveCloudSubjectId('s3');

    // Must be a valid UUID
    assert(isUUID(resolvedUuid), 'resolved ID must be a valid UUID');

    // CRITICAL: Must NOT attach to the existing unrelated cloud subject despite having the same name
    assert.notStrictEqual(
      resolvedUuid,
      EXISTING_UNRELATED_CLOUD_UUID,
      'must NOT silently associate with unrelated existing cloud subject by name'
    );

    // Exactly one new cloud subject should have been provisioned
    assert.strictEqual(
      mockCloud._dbSubjects.length,
      cloudSubjectsCountBefore + 1,
      'provisions exactly one new cloud subject'
    );

    const newlyCreated = mockCloud._dbSubjects.find(s => s.id === resolvedUuid);
    assert(newlyCreated, 'newly provisioned cloud subject exists in cloud repo');
    assert.strictEqual(newlyCreated.name, 'Literature', 'new cloud subject has local subject name');
    assert.strictEqual(newlyCreated.color, '#ec4899', 'new cloud subject has local subject color');

    // Persistent mapping must be stored in sp_migration_map_${userId}
    const updatedMapRaw = localStorage.getItem(`sp_migration_map_${USER_ID}`);
    assert(updatedMapRaw, 'migration map persisted to localStorage');
    const updatedMap = JSON.parse(updatedMapRaw);
    assert.strictEqual(
      updatedMap.subjects['s3'],
      resolvedUuid,
      'persists s3 -> newly provisioned UUID mapping'
    );

    // Subsequent resolution must reuse stored mapping without creating additional cloud subjects
    const countAfterFirstResolve = mockCloud._dbSubjects.length;
    const resolvedAgain = await Notes.resolveCloudSubjectId('s3');
    assert.strictEqual(
      resolvedAgain,
      resolvedUuid,
      'subsequent resolve reuses the stored persistent mapping'
    );
    assert.strictEqual(
      mockCloud._dbSubjects.length,
      countAfterFirstResolve,
      'no duplicate cloud subject created on subsequent resolve'
    );
  });

  // 14. DOM verification: New Note and Edit Note populate real select with options.length > 1 and expected subject names
  await runTest('14. DOM verification: New Note and Edit Note populate real select with options.length > 1 and expected subject names', () => {
    const noteSubjectSelect = createDOMSelect();
    const noteTitleInput = { value: '', focus: () => {} };
    const noteContentInput = { value: '' };
    const noteIdInput = { value: '' };
    const notePinnedInput = { checked: false };
    const noteModalTitle = { textContent: '' };
    const modalWordCount = { textContent: '' };
    const formElement = {
      reset: () => {
        noteTitleInput.value = '';
        noteContentInput.value = '';
        noteIdInput.value = '';
        notePinnedInput.checked = false;
        noteSubjectSelect.value = '';
      }
    };

    const elements = {
      '#noteSubject': noteSubjectSelect,
      '#noteForm': formElement,
      '#noteTitle': noteTitleInput,
      '#noteContent': noteContentInput,
      '#noteId': noteIdInput,
      '#notePinned': notePinnedInput,
      '#noteModalTitle': noteModalTitle,
      '#modalWordCount': modalWordCount
    };

    global.document = {
      querySelector: (sel) => elements[sel] || null,
      querySelectorAll: () => []
    };
    global.App = {
      qs: (sel) => elements[sel] || null,
      qsa: () => [],
      escapeHtml: (s) => String(s),
      toast: () => {},
      openModal: () => {},
      closeModal: () => {}
    };

    // --- A. NEW NOTE ---
    RepositoryFactory._mode = 'local';
    Notes.openNoteModal(null);

    const selectEl = document.querySelector('#noteSubject');
    assert(selectEl, '#noteSubject element exists in document');
    assert(
      selectEl.options.length > 1,
      `After opening New Note: selectEl.options.length (${selectEl.options.length}) must be > 1`
    );

    const newOptionTexts = selectEl.options.map(o => o.text);
    assert(newOptionTexts.includes('Mathematics'), 'New Note dropdown includes Mathematics');
    assert(newOptionTexts.includes('Physics'), 'New Note dropdown includes Physics');
    assert.strictEqual(selectEl.value, '', 'New Note default selection is empty');

    // --- B. EDIT LOCAL NOTE ---
    Notes.openNoteModal('local-note-1');
    assert(
      selectEl.options.length > 1,
      `After opening Edit Note: selectEl.options.length (${selectEl.options.length}) must be > 1`
    );
    const editOptionTexts = selectEl.options.map(o => o.text);
    assert(editOptionTexts.includes('Mathematics'), 'Edit Note dropdown includes Mathematics');
    assert.strictEqual(selectEl.value, 's2', 'Edit Note selects local subject s2');

    // --- C. EDIT CLOUD NOTE ---
    localStorage.setItem(`sp_cloud_sp_subjects_${USER_ID}`, JSON.stringify([
      { id: CLOUD_SUBJ_UUID, name: 'Chemistry', color: '#f59e0b' }
    ]));
    Notes.view.activeDetailId = CLOUD_NOTE_ID;
    Notes.view.activeDetailNote = {
      id: CLOUD_NOTE_ID,
      title: 'Cloud Note Title',
      content: 'Cloud Note Content',
      subjectId: CLOUD_SUBJ_UUID
    };
    Notes.openNoteModal(CLOUD_NOTE_ID);
    assert(
      selectEl.options.length > 1,
      `After opening Cloud Edit Note: selectEl.options.length (${selectEl.options.length}) must be > 1`
    );
    assert(selectEl.options.some(o => o.text === 'Chemistry'), 'Cloud Edit Note dropdown includes Chemistry');
    assert.strictEqual(selectEl.value, CLOUD_SUBJ_UUID, 'Cloud Edit Note selects assigned cloud subject UUID');
  });

  console.log('\n========================================');
  console.log(`Notes Subject-Mapping Test Results: ${passedCount} passed, ${failedCount} failed`);
  console.log('========================================');
}

main().then(() => {
  if (failedCount > 0) process.exit(1);
});
