/* ==========================================================================
   notes.js — Notes & Knowledge Management Controller
   Features:
   - In-memory single-snapshot aggregation
   - Pinned / Favorite notes support (pinned-first sorting)
   - Search across title, content, and subject name with term highlighting
   - Filter by status (All vs Pinned) and Subject
   - Sort by Recently Updated, Recently Created, Title A–Z, Title Z–A, Subject
   - Full Note Detail reading modal with comfortable typography
   - Add/Edit modal with pinned toggle, live word count, and Cmd/Ctrl+Enter
   - Contextual empty states and quick clear filters
   - URL deep links (?noteId=..., ?action=new, ?subject=..., ?filter=pinned)
   ========================================================================== */

const view = {
  search: '',
  subject: '',
  filter: 'all', // 'all' | 'pinned'
  sort: 'updated',
  activeDetailId: null,
  activeDetailNote: null   // retains the currently-open note (incl. cloud-only rows)
};

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    readUrlParams();
    populateSubjectDropdowns();
    bindToolbar();
    bindModals();
    render();
    handleUrlDeepLinks();
  });

  const repoModule = (typeof window !== 'undefined' && window.StudyFlowRepository) ? window.StudyFlowRepository : null;
  if (repoModule && repoModule.RepositoryFactory && typeof repoModule.RepositoryFactory.onModeChange === 'function') {
    repoModule.RepositoryFactory.onModeChange(() => {
      populateSubjectDropdowns();
    });
  }
}

function readUrlParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('search')) {
    view.search = params.get('search').trim().toLowerCase();
    const input = App.qs('#noteSearch');
    if (input) input.value = params.get('search');
  }
  if (params.has('subject')) {
    view.subject = params.get('subject');
  }
  if (params.get('filter') === 'pinned') {
    view.filter = 'pinned';
  }
  if (params.has('sort')) {
    view.sort = params.get('sort');
    const sortSelect = App.qs('#sortNotesBy');
    if (sortSelect) sortSelect.value = view.sort;
  }
}

function handleUrlDeepLinks() {
  const params = new URLSearchParams(window.location.search);

  // 1. Check auto action for new note
  if (params.get('action') === 'new') {
    const subId = params.get('subject') || view.subject;
    openNoteModal(null, subId);
    return;
  }

  // 2. Check direct note deep-link (?noteId=...)
  if (params.has('noteId')) {
    const noteId = params.get('noteId');

    // The synchronous snapshot is often empty here: on a fresh page load the
    // Supabase session restore (Auth.init) and the cloud-mode selection it
    // drives complete asynchronously, *after* this DOMContentLoaded handler.
    // So do not decide "not found" from the initial in-memory snapshot —
    // resolve against a fully initialized repository first.
    const immediate = Store.getNote(noteId);
    if (immediate) {
      openNoteDetailModal(noteId);
      return;
    }

    resolveNoteFromCloud(noteId).then(resolved => {
      if (resolved) {
        render();
        // Pass the resolved row so the modal can display a cloud-only note even
        // when it is not present in the (local-mode) Store cache.
        openNoteDetailModal(noteId, resolved);
      } else {
        App.toast('Note not found or may have been deleted', 'error');
      }
    });
  }
}

/**
 * Resolves a note deep link once the repository is actually ready.
 *
 * ROOT CAUSE this addresses (two layers):
 *  1. Timing: notes.js runs its deep-link handler on DOMContentLoaded, before
 *     Auth.init() has restored the Supabase session and before cloud mode is
 *     selected. So the initial Store.getNote reads an empty/local snapshot.
 *  2. Mode gating: cloud mode is only selected when
 *     `migration.isCompleted(user.id)` is true (repository.js RepositoryFactory
 *     .init + app.js renderAuthNav). A note created by the browser extension is
 *     written straight to Supabase regardless of migration, so a signed-in user
 *     whose migration is not completed in *this* browser stays in local mode and
 *     could never see the note — the previous fix only acted in cloud mode.
 *
 * Strategy (reuses existing methods only — no new cache, no repo rewrite, no
 * setTimeout, no fake note, no RLS change):
 *  (A) If cloud mode: await hydrateCache() and read via the cloud-routed Store.
 *  (B) Else if authenticated: fetch that single row directly through the
 *      RLS-scoped CloudRepository.getNote(id). RLS enforces ownership on the
 *      server; a non-owner/anonymous read simply returns null. Global app mode
 *      is left untouched (an unmigrated user's local planner is not disturbed).
 *  (C) Else: fall back to the local Store (covers a genuine local-only note).
 * Returns the note (from cache or cloud) or null.
 */
async function resolveNoteFromCloud(noteId) {
  if (!noteId) return null;
  try {
    const rf = await ensureRepositoryReady();
    const mode = rf && typeof rf.getMode === 'function' ? rf.getMode() : 'n/a';
    const user = (typeof window !== 'undefined' && window.Auth && window.Auth.getUser)
      ? window.Auth.getUser() : null;

    // (A) Cloud mode — hydrate the per-user cache, then read via the same key.
    if (rf && mode === 'cloud') {
      const repo = rf.getActive();
      if (repo && typeof repo.hydrateCache === 'function') {
        await repo.hydrateCache();
      }
      const hit = Store.getNote(noteId);
      if (hit) return hit;
    }

    // (B) Authenticated but NOT in cloud mode — resolve the single cloud row
    //     directly. RLS scopes it to the authenticated owner.
    if (rf && user && user.id && typeof rf.getRepository === 'function') {
      const cloud = rf.getRepository('cloud');
      if (cloud && typeof cloud.getNote === 'function') {
        const row = await cloud.getNote(noteId);
        if (row) return row;
      }
    }

    // (C) Final fallback: the local store (genuine local note, or not found).
    const local = Store.getNote(noteId);
    return local;
  } catch (err) {
    // Surface the real reason instead of hiding it behind "not found".
    console.error('[StudyFlow] deep-link cloud resolve failed:', err);
    return null;
  }
}

/**
 * Awaits the auth + repository lifecycle so the deep-link lookup does not race
 * initialization. Both calls are idempotent:
 *  - Auth.init() caches its promise and restores the Supabase session.
 *  - RepositoryFactory.init() inspects the (now-restored) auth user + migration
 *    state and selects cloud/local mode exactly as the app's nav does.
 * Returns the RepositoryFactory (or null if unavailable).
 */
async function ensureRepositoryReady() {
  if (typeof window !== 'undefined' && window.Auth && typeof window.Auth.init === 'function') {
    try { await window.Auth.init(); } catch { /* Continue with local fallback if auth is unavailable. */ }
  }
  const repoModule = (typeof window !== 'undefined' && window.StudyFlowRepository)
    ? window.StudyFlowRepository
    : null;
  const rf = repoModule && repoModule.RepositoryFactory;
  if (rf && typeof rf.init === 'function') {
    try { await rf.init(); } catch { /* Continue with the available repository state. */ }
  }
  return rf;
}

/* ==========================================================================
   Subject Architecture, Mapping & Dropdowns
   ========================================================================== */
function isUUID(str) {
  return typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str.trim());
}

function generateUUID() {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    if (typeof crypto.getRandomValues === 'function') {
      return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
      );
    }
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function getMigrationIdMap(userId) {
  const empty = { subjects: {}, tasks: {}, habits: {}, notes: {}, sessions: {} };
  if (!userId) return empty;
  const migration = (typeof window !== 'undefined' && window.StudyFlowMigration)
    ? window.StudyFlowMigration
    : (typeof global !== 'undefined' ? global.StudyFlowMigration : null);
  if (migration && typeof migration._getIdMap === 'function') {
    return migration._getIdMap(userId);
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(`sp_migration_map_${userId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          subjects: parsed.subjects || {},
          tasks: parsed.tasks || {},
          habits: parsed.habits || {},
          notes: parsed.notes || {},
          sessions: parsed.sessions || {}
        };
      }
    }
  } catch {}
  return empty;
}

function saveMigrationIdMap(userId, idMap) {
  if (!userId) return;
  const migration = (typeof window !== 'undefined' && window.StudyFlowMigration)
    ? window.StudyFlowMigration
    : (typeof global !== 'undefined' ? global.StudyFlowMigration : null);
  if (migration && typeof migration._saveIdMap === 'function') {
    migration._saveIdMap(userId, idMap);
    return;
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`sp_migration_map_${userId}`, JSON.stringify(idMap));
    }
  } catch (e) {
    console.error('[StudyFlow] Failed to save migration ID map:', e);
  }
}

function isCloudNote(noteOrId) {
  const m = typeof window !== 'undefined' ? window.StudyFlowRepository : (typeof global !== 'undefined' ? global.StudyFlowRepository : null);
  const rf = m && m.RepositoryFactory;
  if (rf && typeof rf.getMode === 'function' && rf.getMode() === 'cloud') {
    return true;
  }
  if (!noteOrId) return false;
  const id = (typeof noteOrId === 'object' && noteOrId !== null) ? noteOrId.id : noteOrId;
  if (!id) return false;
  // If the note exists in local Store, it is a local note!
  if (typeof Store !== 'undefined' && typeof Store.getNote === 'function') {
    const local = Store.getNote(id);
    if (local) return false;
  }
  if (isUUID(id)) return true;
  if (view.activeDetailNote && view.activeDetailNote.id === id && isUUID(view.activeDetailNote.id)) {
    return true;
  }
  return false;
}

/**
 * Resolves a selected subject ID for a cloud-backed note to a real cloud subject UUID.
 * Supports:
 * - valid cloud subject UUID -> preserves UUID directly
 * - empty / missing subject -> null
 * - local subject ID -> maps to existing cloud UUID from persistent migration map,
 *   or provisions a new cloud subject through CloudRepository.saveSubject and
 *   persists the local->cloud mapping to sp_migration_map_${userId}.
 *   (Never silently associates by subject name due to non-unique subject names).
 * - missing/deleted subject -> null
 */
async function resolveCloudSubjectId(subjectId) {
  if (!subjectId || typeof subjectId !== 'string') return null;
  const trimmed = subjectId.trim();
  if (!trimmed) return null;

  // 1. Valid UUID: keep directly
  if (isUUID(trimmed)) {
    return trimmed;
  }

  // 2. Local-only subject ID (e.g. "s1", "mupjxnjyy3f4m")
  const user = (typeof window !== 'undefined' && window.Auth && window.Auth.getUser)
    ? window.Auth.getUser() : null;
  if (!user || !user.id) return null;

  const idMap = getMigrationIdMap(user.id);
  if (idMap.subjects && idMap.subjects[trimmed] && isUUID(idMap.subjects[trimmed])) {
    return idMap.subjects[trimmed];
  }

  // Find local subject metadata
  let localSubj = Store.getSubject(trimmed);
  if (!localSubj && typeof Store._read === 'function') {
    try {
      const rawLocal = Store._read('sp_subjects', []);
      if (Array.isArray(rawLocal)) {
        localSubj = rawLocal.find(s => s && s.id === trimmed) || null;
      }
    } catch {}
  }
  if (!localSubj && typeof localStorage !== 'undefined') {
    try {
      const rawLocal = localStorage.getItem('sp_subjects');
      if (rawLocal) {
        const parsed = JSON.parse(rawLocal);
        if (Array.isArray(parsed)) {
          localSubj = parsed.find(s => s && s.id === trimmed) || null;
        }
      }
    } catch {}
  }
  if (!localSubj) {
    // Missing or deleted subject: clearly keep unassigned
    return null;
  }

  const m = (typeof window !== 'undefined') ? window.StudyFlowRepository : (typeof global !== 'undefined' ? global.StudyFlowRepository : null);
  const rf = m && m.RepositoryFactory;
  if (!rf || typeof rf.getRepository !== 'function') return null;
  const cloudRepo = rf.getRepository('cloud');
  if (!cloudRepo) return null;

  try {
    // Provision through existing supported CloudRepository API
    if (typeof cloudRepo.saveSubject === 'function') {
      const cloudSubjectId = generateUUID();
      const saved = await cloudRepo.saveSubject({
        id: cloudSubjectId,
        name: localSubj.name,
        color: localSubj.color,
        teacher: localSubj.teacher,
        code: localSubj.code,
        examDate: localSubj.examDate
      });

      const finalId = (saved && isUUID(saved.id)) ? saved.id : cloudSubjectId;
      idMap.subjects = idMap.subjects || {};
      idMap.subjects[trimmed] = finalId;
      saveMigrationIdMap(user.id, idMap);
      return finalId;
    }
    return null;
  } catch (err) {
    console.error('[StudyFlow] Failed to resolve cloud subject for note:', err);
    return null;
  }
}

/**
 * Synchronously retrieves all available subjects from every possible store:
 * 1. Store.getSubjects() (in local mode reads sp_subjects; in cloud mode reads cloud cache)
 * 2. Raw localStorage['sp_subjects'] (crucial fallback when Store is in cloud mode but cloud cache is empty)
 * 3. Raw localStorage['sp_cloud_sp_subjects_<uid>'] (per-user cached cloud subjects)
 * 4. Migration map (sp_migration_map_<uid>)
 * Deduplicates by subject id so the dropdown NEVER disappears or becomes blank.
 */
function getAllAvailableSubjects() {
  const list = [];
  const seenIds = new Set();

  function addSubject(s) {
    if (!s || typeof s !== 'object') return;
    const id = s.id ? String(s.id).trim() : '';
    const name = s.name ? String(s.name).trim() : '';
    if (!id || !name) return;
    if (seenIds.has(id)) return;
    seenIds.add(id);
    list.push({
      id,
      name,
      color: s.color || '#7c3aed',
      teacher: s.teacher || '',
      examDate: s.examDate || ''
    });
  }

  // 1. Store.getSubjects()
  try {
    if (typeof Store !== 'undefined' && typeof Store.getSubjects === 'function') {
      const storeSubs = Store.getSubjects();
      if (Array.isArray(storeSubs)) {
        storeSubs.forEach(addSubject);
      }
    }
  } catch (e) {
    console.warn('[StudyFlow] Error reading Store.getSubjects:', e);
  }

  // 2. Raw localStorage 'sp_subjects'
  // When RepositoryFactory is in cloud mode, Store.getSubjects() routes to
  // sp_cloud_sp_subjects_<uid>. If Supabase subjects table is empty,
  // Store.getSubjects() returns []. Reading raw sp_subjects ensures local
  // subjects (Mathematics, Database, etc.) are NEVER lost!
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem('sp_subjects');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach(addSubject);
        }
      }
    }
  } catch (e) {
    console.warn('[StudyFlow] Error reading localStorage sp_subjects:', e);
  }

  // 3. User cached cloud subjects: sp_cloud_sp_subjects_<uid>
  try {
    const user = (typeof window !== 'undefined' && window.Auth && window.Auth.getUser)
      ? window.Auth.getUser() : null;
    if (user && user.id && typeof localStorage !== 'undefined') {
      const rawCloud = localStorage.getItem(`sp_cloud_sp_subjects_${user.id}`);
      if (rawCloud) {
        const parsedCloud = JSON.parse(rawCloud);
        if (Array.isArray(parsedCloud)) {
          parsedCloud.forEach(addSubject);
        }
      }
    }
  } catch (e) {
    console.warn('[StudyFlow] Error reading cached cloud subjects:', e);
  }

  // 4. Migration map subjects
  try {
    const user = (typeof window !== 'undefined' && window.Auth && window.Auth.getUser)
      ? window.Auth.getUser() : null;
    if (user && user.id) {
      const idMap = getMigrationIdMap(user.id);
      if (idMap && idMap.subjects) {
        Object.entries(idMap.subjects).forEach(([locId, cloudUuid]) => {
          if (cloudUuid && isUUID(cloudUuid)) {
            const existing = list.find(s => s.id === locId);
            if (existing && !seenIds.has(cloudUuid)) {
              addSubject({ ...existing, id: cloudUuid });
            }
          }
        });
      }
    }
  } catch (e) {
    console.warn('[StudyFlow] Error reading migration map:', e);
  }

  return list;
}


/**
 * Resolves a subject entity for display across notes cards, detail modal, and filters.
 * Works seamlessly for local subjects, cloud UUID subjects, and mapped subjects.
 */
function resolveSubjectForDisplay(subjectId) {
  if (!subjectId) return null;
  const fromStore = Store.getSubject(subjectId);
  if (fromStore) return fromStore;

  const allAvailable = getAllAvailableSubjects();
  const directHit = allAvailable.find(s => s.id === subjectId);
  if (directHit) return directHit;

  const user = (typeof window !== 'undefined' && window.Auth && window.Auth.getUser)
    ? window.Auth.getUser() : null;
  if (user && user.id) {
    // Check cached cloud subjects
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(`sp_cloud_sp_subjects_${user.id}`);
        if (raw) {
          const cached = JSON.parse(raw);
          if (Array.isArray(cached)) {
            const hit = cached.find(s => s && s.id === subjectId);
            if (hit) return hit;
          }
        }
      }
    } catch {}

    // Check migration map: if subjectId is a cloud UUID mapped from a local subject
    const idMap = getMigrationIdMap(user.id);
    if (idMap && idMap.subjects) {
      for (const [locId, cloudId] of Object.entries(idMap.subjects)) {
        if (cloudId === subjectId) {
          let localSubj = allAvailable.find(s => s.id === locId) || Store.getSubject(locId);
          if (localSubj) return { ...localSubj, id: cloudId };
        }
      }
    }
  }

  // Also check raw local storage 'sp_subjects' if Store was routed to cloud cache
  try {
    if (typeof localStorage !== 'undefined') {
      const rawLocal = localStorage.getItem('sp_subjects');
      if (rawLocal) {
        const parsed = JSON.parse(rawLocal);
        if (Array.isArray(parsed)) {
          const hit = parsed.find(s => s && s.id === subjectId);
          if (hit) return hit;
        }
      }
    }
  } catch {}

  return null;
}

/**
 * Builds a comprehensive lookup map for all available subjects (local + cloud + mapped).
 */
async function getSubjectsMapForRender() {
  const subjectsMap = {};
  const availableSubjects = getAllAvailableSubjects();
  availableSubjects.forEach(s => { if (s && s.id) subjectsMap[s.id] = s; });

  const user = (typeof window !== 'undefined' && window.Auth && window.Auth.getUser)
    ? window.Auth.getUser() : null;
  if (!user || !user.id) return subjectsMap;

  // 1. Add mappings from migration idMap
  const idMap = getMigrationIdMap(user.id);
  if (idMap && idMap.subjects) {
    Object.entries(idMap.subjects).forEach(([locId, cloudId]) => {
      if (cloudId && isUUID(cloudId) && subjectsMap[locId]) {
        subjectsMap[cloudId] = { ...subjectsMap[locId], id: cloudId };
      }
    });
  }

  // 2. Fetch fresh cloud subjects (or read cached)
  const m = (typeof window !== 'undefined') ? window.StudyFlowRepository : (typeof global !== 'undefined' ? global.StudyFlowRepository : null);
  const rf = m && m.RepositoryFactory;
  if (!rf || typeof rf.getRepository !== 'function') return subjectsMap;
  const cloudRepo = rf.getRepository('cloud');
  if (!cloudRepo || typeof cloudRepo.getSubjects !== 'function') return subjectsMap;

  try {
    const cloudSubjects = await cloudRepo.getSubjects();
    if (Array.isArray(cloudSubjects)) {
      cloudSubjects.forEach(cs => {
        if (cs && cs.id) subjectsMap[cs.id] = cs;
      });
    }
  } catch {
    // Already populated from local/cached in getAllAvailableSubjects
  }

  return subjectsMap;
}

/**
 * Populates the subject select in the note add/edit modal.
 * Follows the strict order:
 * 1. form.reset() was executed before this function
 * 2. obtain all available subjects
 * 3. create <option> elements
 * 4. append options to formSelect
 * 5. set selected value
 */
function populateNoteModalSubjects(isCloud, currentSubjectId, modalMode = 'new') {
  const formSelect = App.qs('#noteSubject');
  if (!formSelect) return;

  const user = (typeof window !== 'undefined' && window.Auth && window.Auth.getUser)
    ? window.Auth.getUser() : null;
  const idMap = (user && user.id) ? (getMigrationIdMap(user.id).subjects || {}) : {};

  // Obtain unified available subjects from all stores
  const subjects = getAllAvailableSubjects();

  // If a note is being edited with currentSubjectId that is not in subjects,
  // preserve it so the assigned subject doesn't disappear from the select
  if (currentSubjectId && !subjects.some(s => s.id === currentSubjectId)) {
    const displaySubj = resolveSubjectForDisplay(currentSubjectId);
    subjects.push({
      id: currentSubjectId,
      name: displaySubj ? displaySubj.name : 'Assigned Subject',
      color: displaySubj ? displaySubj.color : '#7c3aed'
    });
  }

  // Build options
  let optionsHtml = '<option value="">— No subject —</option>';
  subjects.forEach(s => {
    if (s && s.id) {
      optionsHtml += `<option value="${s.id}">${App.escapeHtml(s.name)}</option>`;
    }
  });

  // 1. form.reset() was executed before this function
  // 2. create & append <option> elements
  formSelect.innerHTML = optionsHtml;

  // 3. set selected value AFTER options exist in DOM
  if (currentSubjectId) {
    if (subjects.some(s => s.id === currentSubjectId)) {
      formSelect.value = currentSubjectId;
    } else {
      const mappedCloudId = idMap[currentSubjectId];
      if (mappedCloudId && subjects.some(s => s.id === mappedCloudId)) {
        formSelect.value = mappedCloudId;
      } else {
        let matchedLocalId = null;
        for (const [locId, cId] of Object.entries(idMap)) {
          if (cId === currentSubjectId && subjects.some(s => s.id === locId)) {
            matchedLocalId = locId;
            break;
          }
        }
        formSelect.value = matchedLocalId || '';
      }
    }
  } else {
    formSelect.value = '';
  }
}

function populateSubjectDropdowns() {
  const subjects = getAllAvailableSubjects();
  let options = subjects.map(s => `<option value="${s.id}">${App.escapeHtml(s.name)}</option>`).join('');

  const filterSelect = App.qs('#filterNoteSubject');
  const formSelect = App.qs('#noteSubject');

  if (filterSelect) {
    filterSelect.innerHTML = '<option value="">All subjects</option>' + options;
    if (view.subject) filterSelect.value = view.subject;
  }

  if (formSelect) {
    formSelect.innerHTML = '<option value="">— No subject —</option>' + options;
  }
}

/* ==========================================================================
   Toolbar wiring & filter events
   ========================================================================== */
function bindToolbar() {
  const searchInput = App.qs('#noteSearch');
  if (searchInput) {
    searchInput.addEventListener('input', App.debounce(e => {
      view.search = e.target.value.trim().toLowerCase();
      render();
    }, 150));
  }

  // Filter pills (All vs Pinned)
  App.qsa('#filterNotePills [data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      view.filter = btn.dataset.filter;
      updateFilterPillUI();
      render();
    });
  });

  // Subject filter dropdown
  const filterSubject = App.qs('#filterNoteSubject');
  if (filterSubject) {
    filterSubject.addEventListener('change', e => {
      view.subject = e.target.value;
      render();
    });
  }

  // Sort dropdown
  const sortSelect = App.qs('#sortNotesBy');
  if (sortSelect) {
    sortSelect.addEventListener('change', e => {
      view.sort = e.target.value;
      render();
    });
  }

  // Clear filters button
  const clearBtn = App.qs('#clearNoteFiltersBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      view.search = '';
      view.subject = '';
      view.filter = 'all';
      if (searchInput) searchInput.value = '';
      if (filterSubject) filterSubject.value = '';
      updateFilterPillUI();
      render();
    });
  }

  // Add Note header button
  const addBtn = App.qs('#addNoteBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => openNoteModal(null, view.subject));
  }
}

function updateFilterPillUI() {
  App.qsa('#filterNotePills [data-filter]').forEach(btn => {
    const isActive = btn.dataset.filter === view.filter;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
  });
}

/* ==========================================================================
   Data snapshot & in-memory filtering / sorting
   ========================================================================== */
function getFilteredNotes(allNotes, subjectsMap) {
  let notes = [...allNotes];

  // Filter by status (pinned vs all)
  if (view.filter === 'pinned') {
    notes = notes.filter(n => n.pinned);
  }

  // Filter by subject
  if (view.subject) {
    notes = notes.filter(n => n.subjectId === view.subject);
  }

  // Search filter (searches title, content, and subject name)
  if (view.search) {
    notes = notes.filter(n => {
      const titleMatch = (n.title || '').toLowerCase().includes(view.search);
      const contentMatch = (n.content || '').toLowerCase().includes(view.search);
      const subj = subjectsMap[n.subjectId];
      const subjMatch = subj ? subj.name.toLowerCase().includes(view.search) : false;
      return titleMatch || contentMatch || subjMatch;
    });
  }

  // Sorting: Pinned notes always sort to the top, then sorted by chosen order
  notes.sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }

    switch (view.sort) {
      case 'created':
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      case 'title_asc':
        return (a.title || '').localeCompare(b.title || '');
      case 'title_desc':
        return (b.title || '').localeCompare(a.title || '');
      case 'subject': {
        const subA = (subjectsMap[a.subjectId]?.name || 'zzz').toLowerCase();
        const subB = (subjectsMap[b.subjectId]?.name || 'zzz').toLowerCase();
        return subA.localeCompare(subB) || (b.updatedAt || '').localeCompare(a.updatedAt || '');
      }
      case 'updated':
      default:
        return (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '');
    }
  });

  return notes;
}

/* ==========================================================================
   Highlight search matches safely
   ========================================================================== */
function highlightText(text = '', query = '') {
  const safeText = App.escapeHtml(text);
  if (!query || !query.trim()) return safeText;

  const q = query.trim();
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  return safeText.replace(regex, '<mark class="search-highlight">$1</mark>');
}

/* ==========================================================================
   Note list: merge local + cloud (when authenticated but migration incomplete)
   ========================================================================== */

/**
 * Returns the notes to display in the main list.
 *
 * When the RepositoryFactory is in 'cloud' mode, delegates to the active
 * (cloud) repository as before — no change to existing behavior.
 *
 * When in 'local' mode BUT the user is authenticated, also fetches the
 * user's cloud notes (RLS-scoped via CloudRepository.getNotes) and merges
 * them with local notes. This surfaces extension-created notes and any
 * notes created in a migrated browser, without switching the app to cloud
 * mode or writing fake local records.
 *
 * Merge rule: local notes win on ID collision (preserves local edits);
 * cloud-only notes are appended. Returns local notes immediately on any
 * error so the list is never emptied by a cloud fetch failure.
 */
async function getDisplayNotes() {
  const rf = (typeof window !== 'undefined' && window.StudyFlowRepository && window.StudyFlowRepository.RepositoryFactory) || null;
  const mode = rf && typeof rf.getMode === 'function' ? rf.getMode() : 'local';

  if (mode === 'cloud') {
    const repo = rf.getActive();
    if (repo && typeof repo.getNotes === 'function') {
      try { return await repo.getNotes(); } catch { return Store.getNotes(); }
    }
    return Store.getNotes();
  }

  // Local mode: check if user is authenticated for cloud supplement
  const user = (typeof window !== 'undefined' && window.Auth && window.Auth.getUser)
    ? window.Auth.getUser() : null;
  if (!user || !user.id) return Store.getNotes();

  const localNotes = Store.getNotes();

  // Try to fetch cloud notes without switching global mode
  try {
    if (!rf || typeof rf.getRepository !== 'function') return localNotes;
    const cloudRepo = rf.getRepository('cloud');
    if (!cloudRepo || typeof cloudRepo.getNotes !== 'function') return localNotes;

    const cloudNotes = await cloudRepo.getNotes();
    if (!Array.isArray(cloudNotes)) return localNotes;

    // Merge: local wins on ID collision, cloud-only notes appended
    const localIds = new Set(localNotes.map(n => n.id));
    const cloudOnly = cloudNotes.filter(n => !localIds.has(n.id));
    return [...localNotes, ...cloudOnly];
  } catch (err) {
    return localNotes;
  }
}

/* ==========================================================================
   Render main view
   ========================================================================== */
function render() {
  Promise.all([getDisplayNotes(), getSubjectsMapForRender()])
    .then(([allNotes, subjectsMap]) => {
      _renderNotes(allNotes, subjectsMap);
    })
    .catch(() => {
      // On any async rejection, render local notes so the list is never empty
      _renderNotes(Store.getNotes());
    });
}

function _renderNotes(allNotes, subjectsMapOverride = null) {
  const allSubjects = Store.getSubjects();
  let subjectsMap = subjectsMapOverride;
  if (!subjectsMap) {
    subjectsMap = {};
    allSubjects.forEach(s => { subjectsMap[s.id] = s; });
  }

  // Update Top Stats Strip
  renderStatsStrip(allNotes, allSubjects);

  // Update Pill Counts
  const countAllEl = App.qs('#countAllNotes');
  const countPinnedEl = App.qs('#countPinnedNotes');
  if (countAllEl) countAllEl.textContent = allNotes.length;
  if (countPinnedEl) countPinnedEl.textContent = allNotes.filter(n => n.pinned).length;

  // Filter notes
  const visibleNotes = getFilteredNotes(allNotes, subjectsMap);
  const grid = App.qs('#notesGrid');
  const countEl = App.qs('#noteResultCount');
  const clearBtn = App.qs('#clearNoteFiltersBtn');

  // Toggle clear filters button visibility
  const hasActiveFilters = Boolean(view.search || view.subject || view.filter !== 'all');
  if (clearBtn) clearBtn.style.display = hasActiveFilters ? 'inline-flex' : 'none';

  // Result count description
  if (countEl) {
    if (allNotes.length === 0) {
      countEl.textContent = '';
    } else if (hasActiveFilters) {
      countEl.textContent = `Showing ${visibleNotes.length} of ${allNotes.length} note${allNotes.length === 1 ? '' : 's'}`;
    } else {
      countEl.textContent = `All ${allNotes.length} note${allNotes.length === 1 ? '' : 's'}`;
    }
  }

  // Handle empty states
  if (!visibleNotes.length) {
    if (grid) {
      grid.innerHTML = renderEmptyState(allNotes.length, subjectsMap);
      wireEmptyStateActions();
    }
    return;
  }

  // Render note cards
  if (grid) {
    grid.innerHTML = visibleNotes.map(n => {
      const subject = subjectsMap[n.subjectId] || resolveSubjectForDisplay(n.subjectId);
      const words = countWords(n.content);
      const readTime = Math.max(1, Math.ceil(words / 150));
      const timestamp = n.updatedAt || n.createdAt;

      const renderedTitle = view.search ? highlightText(n.title, view.search) : App.escapeHtml(n.title);
      const renderedContent = view.search ? highlightText(n.content, view.search) : App.escapeHtml(n.content);

      return `
        <article class="note-card ${n.pinned ? 'note-card--pinned' : ''}" data-id="${n.id}" data-note='${JSON.stringify(n).replace(/'/g, '&#39;')}' tabindex="0" role="listitem" aria-label="Note: ${App.escapeHtml(n.title)}">
          <div class="note-card__head">
            <div class="note-card__title-wrap">
              ${n.pinned ? '<span class="note-pin-indicator" title="Pinned Note" aria-label="Pinned">📌</span>' : ''}
              <h3>${renderedTitle}</h3>
            </div>
            <div class="task-item__actions" onclick="event.stopPropagation()">
              <button class="icon-btn ${n.pinned ? 'active text-warning' : ''}" data-pin title="${n.pinned ? 'Unpin note' : 'Pin note to top'}" aria-label="${n.pinned ? 'Unpin note' : 'Pin note'}">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="${n.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h20"/><path d="M12 18v4"/><path d="m19.07 10.93-1.41 1.41"/>
                </svg>
              </button>
              <button class="icon-btn" data-copy title="Copy note text" aria-label="Copy &quot;${App.escapeHtml(n.title)}&quot; to clipboard">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
              </button>
              <button class="icon-btn" data-edit title="Edit Note" aria-label="Edit &quot;${App.escapeHtml(n.title)}&quot;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
              </button>
              <button class="icon-btn danger" data-delete title="Delete Note" aria-label="Delete &quot;${App.escapeHtml(n.title)}&quot;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>
              </button>
            </div>
          </div>

          ${subject ? `
            <div class="note-card__subject-wrap" onclick="event.stopPropagation()">
              <button type="button" class="note-subject-pill" data-filter-subj="${subject.id}" title="Filter notes for ${App.escapeHtml(subject.name)}">
                <span class="dot" style="background:${subject.color}"></span>
                <span>${App.escapeHtml(subject.name)}</span>
              </button>
            </div>
          ` : ''}

          <div class="note-card__content">${renderedContent}</div>

          <div class="note-card__foot">
            <span>${timestamp ? `Updated ${Dates.timeAgo(timestamp)}` : 'Recently updated'}</span>
            <span>${words} word${words === 1 ? '' : 's'} · ${readTime} min read</span>
          </div>
        </article>`;
    }).join('');

    wireCards();
  }
}

/* ==========================================================================
   Render Stats Strip
   ========================================================================== */
function renderStatsStrip(notes, subjects) {
  const totalNotesEl = App.qs('#statTotalNotes');
  const subjectsCoveredEl = App.qs('#statSubjectsCovered');
  const pinnedNotesEl = App.qs('#statPinnedNotes');
  const latestUpdateEl = App.qs('#statLatestUpdate');

  if (totalNotesEl) totalNotesEl.textContent = notes.length;

  if (subjectsCoveredEl) {
    const subjectsWithNotes = new Set(notes.map(n => n.subjectId).filter(Boolean)).size;
    subjectsCoveredEl.textContent = `${subjectsWithNotes} of ${subjects.length}`;
  }

  if (pinnedNotesEl) {
    const pinnedCount = notes.filter(n => n.pinned).length;
    pinnedNotesEl.textContent = pinnedCount;
  }

  if (latestUpdateEl) {
    if (!notes.length) {
      latestUpdateEl.textContent = '—';
    } else {
      const sortedByUpdate = [...notes].sort((a, b) =>
        (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')
      );
      const latest = sortedByUpdate[0];
      const stamp = latest.updatedAt || latest.createdAt;
      latestUpdateEl.textContent = stamp ? Dates.timeAgo(stamp) : 'Recently';
    }
  }
}

/* ==========================================================================
   Card event wiring
   ========================================================================== */
function wireCards() {
  App.qsa('.note-card').forEach(card => {
    const id = card.dataset.id;
    let cardNote = null;
    try { cardNote = card.dataset.note ? JSON.parse(card.dataset.note) : null; } catch { cardNote = null; }

    // Card click opens detail modal
    card.addEventListener('click', () => openNoteDetailModal(id, cardNote));

    // Keyboard navigation: Enter or Space opens detail modal
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openNoteDetailModal(id, cardNote);
      }
    });

    // Subject pill click inside card filters by subject
    const subjPill = card.querySelector('[data-filter-subj]');
    if (subjPill) {
      subjPill.addEventListener('click', e => {
        e.stopPropagation();
        const targetSubjId = subjPill.dataset.filterSubj;
        view.subject = targetSubjId;
        const select = App.qs('#filterNoteSubject');
        if (select) select.value = targetSubjId;
        render();
      });
    }

    // Pin toggle button
    const pinBtn = card.querySelector('[data-pin]');
    if (pinBtn) {
      pinBtn.addEventListener('click', e => {
        e.stopPropagation();
        pinNoteFromCard(id, cardNote);
      });
    }

    // Copy note
    const copyBtn = card.querySelector('[data-copy]');
    if (copyBtn) {
      copyBtn.addEventListener('click', e => {
        e.stopPropagation();
        const note = Store.getNote(id) || cardNote;
        if (note && navigator.clipboard) {
          navigator.clipboard.writeText(`${note.title}\n\n${note.content}`)
            .then(() => App.toast('Note copied to clipboard!', 'success'))
            .catch(() => App.toast('Could not copy note', 'error'));
        }
      });
    }

    // Edit note
    const editBtn = card.querySelector('[data-edit]');
    if (editBtn) {
      editBtn.addEventListener('click', e => {
        e.stopPropagation();
        // Seed activeDetail so openNoteModal can resolve a cloud-only note.
        if (!Store.getNote(id) && cardNote) {
          view.activeDetailId = id;
          view.activeDetailNote = cardNote;
        }
        openNoteModal(id);
      });
    }

    // Delete note
    const deleteBtn = card.querySelector('[data-delete]');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', e => {
        e.stopPropagation();
        const note = Store.getNote(id) || cardNote;
        if (!note) return;

        const doDelete = () => {
          deleteNoteFromCard(id, note).then(ok => {
            if (ok) {
              App.toast('Note deleted', 'info');
              render();
            } else {
              App.toast('Could not delete note', 'error');
            }
          });
        };

        const confirmDelete = Store.getSettings().preferences?.confirmDelete !== false;
        if (confirmDelete) {
          App.confirm({
            title: 'Delete note?',
            message: `"${note.title}" will be permanently removed.`,
            confirmText: 'Delete',
            onConfirm: doDelete
          });
        } else {
          doDelete();
        }
      });
    }
  });
}

/**
 * Pin/unpin a note from its list card. Routes cloud-only notes (present in the
 * merged display list but absent from local Store) through the cloud repo so
 * the change persists; local notes stay on Store.togglePinNote.
 */
async function pinNoteFromCard(id, cardNote) {
  const localNote = Store.getNote(id);
  if (localNote) {
    const newPinned = Store.togglePinNote(id);
    App.toast(newPinned ? 'Note pinned to top 📌' : 'Note unpinned', 'info');
    render();
    return;
  }
  const note = cardNote;
  if (!note) { App.toast('Note not found', 'error'); return; }
  const repo = repoForActiveNote(note);
  if (!repo || typeof repo.saveNote !== 'function') {
    App.toast('Could not pin note', 'error');
    return;
  }
  try {
    const saved = await repo.saveNote({ id: note.id, title: note.title, content: note.content, subjectId: note.subjectId || '', pinned: !note.pinned });
    App.toast(saved.pinned ? 'Note pinned to top 📌' : 'Note unpinned', 'info');
    render();
  } catch (err) {
    App.toast('Could not pin note', 'error');
  }
}

/**
 * Delete a note from its list card. Cloud-only notes are removed through the
 * cloud repo (RLS-scoped); local notes through the local Store.
 */
async function deleteNoteFromCard(id, note) {
  const localNote = Store.getNote(id);
  if (localNote) {
    Store.deleteNote(id);
    return true;
  }
  const repo = repoForActiveNote(note);
  if (!repo || typeof repo.deleteNote !== 'function') return false;
  try {
    return Boolean(await repo.deleteNote(note.id));
  } catch (err) {
    return false;
  }
}


function countWords(text = '') {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/* ==========================================================================
   Modals binding & handling
   ========================================================================== */
function bindModals() {
  // Add / Edit Modal
  App.bindModalClose('#noteModal');
  const form = App.qs('#noteForm');
  if (form) form.addEventListener('submit', handleSubmitNote);

  const contentEl = App.qs('#noteContent');
  const countEl = App.qs('#modalWordCount');

  if (contentEl && countEl) {
    contentEl.addEventListener('input', () => {
      const words = countWords(contentEl.value);
      countEl.textContent = `${words} word${words === 1 ? '' : 's'}`;
    });
  }

  // Keyboard shortcut: Cmd/Ctrl + Enter in noteForm submits the form
  if (form) {
    form.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSubmitNote(e);
      }
    });
  }

  // Clear validation styling on input
  ['noteTitle', 'noteContent'].forEach(id => {
    const el = App.qs('#' + id);
    if (el) {
      el.addEventListener('input', e => {
        const field = e.target.closest('.field');
        if (field) field.classList.remove('invalid');
      });
    }
  });

  // Note Detail Modal
  App.bindModalClose('#noteDetailModal');

  // Detail Modal Actions
  const detailCopyBtn = App.qs('#detailCopyBtn');
  if (detailCopyBtn) {
    detailCopyBtn.addEventListener('click', () => {
      if (!view.activeDetailId) {
        return;
      }
      const note = getActiveDetailNote();
      if (!note) {
        return;
      }
      if (navigator.clipboard) {
        navigator.clipboard.writeText(`${note.title}\n\n${note.content}`)
          .then(() => App.toast('Note copied to clipboard!', 'success'))
          .catch(err => { console.error('[StudyFlow] Failed to copy note:', err); App.toast('Could not copy note', 'error'); });
      }
    });
  }

  const detailPinBtn = App.qs('#detailPinBtn');
  if (detailPinBtn) {
    detailPinBtn.addEventListener('click', () => {
      if (!view.activeDetailId) {
        return;
      }
      pinDetailNote();
    });
  }

  const detailEditBtn = App.qs('#detailEditBtn');
  if (detailEditBtn) {
    detailEditBtn.addEventListener('click', () => {
      const noteId = view.activeDetailId;
      if (!noteId) return;
      App.closeModal('#noteDetailModal');
      openNoteModal(noteId);
    });
  }

  const detailDeleteBtn = App.qs('#detailDeleteBtn');
  if (detailDeleteBtn) {
    detailDeleteBtn.addEventListener('click', () => {
      if (!view.activeDetailId) {
        return;
      }
      const note = getActiveDetailNote();
      if (!note) {
        return;
      }

      const doDelete = () => {
        deleteDetailNote(note).then(ok => {
          if (ok) {
            App.closeModal('#noteDetailModal');
            view.activeDetailId = null;
            view.activeDetailNote = null;
            App.toast('Note deleted', 'info');
            render();
          } else {
            App.toast('Could not delete note', 'error');
          }
        });
      };

      const confirmDelete = Store.getSettings().preferences?.confirmDelete !== false;
      if (confirmDelete) {
        App.confirm({
          title: 'Delete note?',
          message: `"${note.title}" will be permanently removed.`,
          confirmText: 'Delete',
          onConfirm: doDelete
        });
      } else {
        doDelete();
      }
    });
  }

  /** Pin/unpin the currently-open detail note, routing cloud-only notes to the
   *  cloud repository so the change persists to Supabase instead of being lost
   *  on a local Store that never held the note. */
  async function pinDetailNote() {
    const note = getActiveDetailNote();
    if (!note) {
      App.toast('Note not found', 'error');
      return;
    }
    const repo = repoForActiveNote(note);
    try {
      if (repo && typeof repo.saveNote === 'function') {
        const saved = await repo.saveNote({ id: note.id, title: note.title, content: note.content, subjectId: note.subjectId || '', pinned: !note.pinned });
        // Refresh the retained/local copy and re-open to reflect the new state.
        view.activeDetailNote = saved;
        if (Store.getNote(note.id)) Store.saveNote({ ...saved, id: note.id });
        openNoteDetailModal(view.activeDetailId, saved);
      } else {
        const isPinned = Store.togglePinNote(view.activeDetailId);
        App.toast(isPinned ? 'Note pinned to top 📌' : 'Note unpinned', 'info');
        openNoteDetailModal(view.activeDetailId, view.activeDetailNote);
      }
      render();
    } catch (err) {
      console.error('[StudyFlow] Failed to pin note:', err);
      App.toast('Could not pin note', 'error');
    }
  }

  /** Delete the currently-open note, routing cloud-only notes through the cloud
   *  repository (RLS-scoped) so they are actually removed from Supabase. */
  async function deleteDetailNote(note) {
    const repo = repoForActiveNote(note);
    try {
      if (repo && typeof repo.deleteNote === 'function') {
        const ok = await repo.deleteNote(note.id);
        return Boolean(ok);
      }
      Store.deleteNote(note.id);
      return true;
    } catch (err) {
      console.error('[StudyFlow] Failed to delete note:', err);
      return false;
    }
  }
}

/* ==========================================================================
   Open Add / Edit Modal
   ========================================================================== */
/**
 * Returns the currently-open detail note.
 * Prefers the retained deep-link note (which may be cloud-only and absent from
 * the local Store), then falls back to the local Store. Never fabricates a note.
 */
function getActiveDetailNote() {
  const id = view.activeDetailId;
  if (!id) {
    return null;
  }
  const fromRetained = view.activeDetailNote;
  const fromStore = Store.getNote(id);
  return fromRetained || fromStore || null;
}

/**
 * Returns the repository to use for mutating the currently-open note.
 * Cloud-only deep-linked notes must be mutated through the cloud repository
 * (RLS-scoped) even when the app is in local mode; ordinary local notes stay
 * in the local Store. No global mode switch, no fake local note.
 */
function repoForActiveNote(noteOrId) {
  const m = (typeof window !== 'undefined') ? window.StudyFlowRepository : null;
  const rf = m && m.RepositoryFactory;
  if (!rf || typeof rf.getRepository !== 'function') return null;
  // Use the cloud repo when the active mode is cloud
  if (rf.getMode && rf.getMode() === 'cloud') return rf.getRepository('cloud');
  const user = (typeof window !== 'undefined' && window.Auth && window.Auth.getUser)
    ? window.Auth.getUser() : null;
  if (!user || !user.id) return null;

  // In local mode: only explicit cloud-backed notes route to cloud repo
  if (noteOrId && isCloudNote(noteOrId)) {
    return rf.getRepository('cloud');
  }
  return null;
}

function openNoteModal(id = null, preselectedSubjectId = null) {
  const form = App.qs('#noteForm');
  if (!form) return;
  form.reset();
  App.qsa('.field').forEach(f => f.classList.remove('invalid'));

  const n = id
    ? ((view.activeDetailNote && view.activeDetailNote.id === id)
      ? view.activeDetailNote
      : (Store.getNote(id) || (view.activeDetailId === id ? view.activeDetailNote : null)))
    : null;

  if (id && !n) {
    App.toast('Note not found', 'error');
    return;
  }

  if (!id) {
    view.activeDetailId = null;
    view.activeDetailNote = null;
  }

  const isCloud = isCloudNote(n || id);
  const currentSubj = n ? (n.subjectId || '') : (preselectedSubjectId || view.subject || '');

  populateNoteModalSubjects(isCloud, currentSubj, id ? `edit (${id})` : 'new');

  if (n) {
    App.qs('#noteModalTitle').textContent = 'Edit Note';
    App.qs('#noteId').value = n.id;
    App.qs('#noteTitle').value = n.title;
    App.qs('#noteContent').value = n.content;
    App.qs('#notePinned').checked = Boolean(n.pinned);
    App.qs('#modalWordCount').textContent = `${countWords(n.content)} words`;
  } else {
    App.qs('#noteModalTitle').textContent = 'Add Note';
    App.qs('#noteId').value = '';
    App.qs('#noteContent').value = '';
    App.qs('#notePinned').checked = view.filter === 'pinned';
    App.qs('#modalWordCount').textContent = '0 words';
  }

  App.openModal('#noteModal');
}

/* ==========================================================================
   Handle Note Form Submission
   ========================================================================== */
async function handleSubmitNote(e) {
  if (e && e.preventDefault) e.preventDefault();
  const title = App.qs('#noteTitle').value.trim();
  const content = App.qs('#noteContent').value.trim();
  let valid = true;

  if (title.length < 1) {
    App.qs('#fn-title')?.classList.add('invalid');
    valid = false;
  }
  if (content.length < 1) {
    App.qs('#fn-content')?.classList.add('invalid');
    valid = false;
  }
  if (!valid) {
    App.toast('Please fill in the required fields', 'error');
    return;
  }

  const id = App.qs('#noteId').value;
  const rawSubjectId = App.qs('#noteSubject').value;

  const noteTarget = id
    ? ((view.activeDetailNote && view.activeDetailNote.id === id)
      ? view.activeDetailNote
      : (Store.getNote(id) || { id }))
    : null;

  const isCloud = isCloudNote(noteTarget || id);
  const repo = repoForActiveNote(noteTarget);

  let finalSubjectId = rawSubjectId;
  if (isCloud) {
    finalSubjectId = await resolveCloudSubjectId(rawSubjectId);
  } else {
    // Normal local note: preserve local subject ID exactly as chosen
    finalSubjectId = rawSubjectId;
  }

  const data = {
    title,
    content,
    subjectId: finalSubjectId || '',
    pinned: App.qs('#notePinned').checked
  };
  if (id) data.id = id;

  const savePromise = (repo && typeof repo.saveNote === 'function')
    ? repo.saveNote(data).then(saved => {
        if (id && Store.getNote(id)) Store.saveNote({ ...saved, id });
        return saved;
      })
    : Promise.resolve().then(() => {
        const saved = Store.saveNote(data);
        return saved;
      });

  savePromise
    .then(saved => {
      view.activeDetailNote = saved || view.activeDetailNote;
      App.closeModal('#noteModal');
      App.toast(id ? 'Note updated' : 'Note created successfully', 'success');
      render();
      if (view.activeDetailId === id && id) {
        openNoteDetailModal(id, saved);
      }
    })
    .catch(err => {
      console.error('[StudyFlow] Failed to save note:', err);
      App.toast('Could not save note', 'error');
    });
}

/* ==========================================================================
   Open Note Detail Reading Modal
   ========================================================================== */
function openNoteDetailModal(id, fallbackNote) {
  // fallbackNote lets a deep link display a cloud-only row that isn't in the
  // (local-mode) Store cache. Store is preferred when present so edits/pins stay
  // in sync; the fallback is the real fetched row, never a fabricated note.
  const note = Store.getNote(id) || fallbackNote || null;
  // Retain the resolved note so the detail actions (pin/edit/delete/copy) can
  // operate on it when it lives in the cloud but not in the local Store.
  view.activeDetailNote = note || null;
  if (!note) {
    App.toast('Note not found', 'error');
    return;
  }

  view.activeDetailId = id;
  const subject = resolveSubjectForDisplay(note.subjectId);
  const words = countWords(note.content);
  const readTime = Math.max(1, Math.ceil(words / 150));
  const timestamp = note.updatedAt || note.createdAt;

  // Title & Badges
  App.qs('#detailNoteTitle').textContent = note.title;

  const pinBadge = App.qs('#detailNotePinBadge');
  if (pinBadge) pinBadge.style.display = note.pinned ? 'inline-flex' : 'none';

  const subjBadge = App.qs('#detailSubjectBadge');
  if (subjBadge) {
    if (subject) {
      subjBadge.innerHTML = `<span class="badge badge-muted"><span class="dot" style="background:${subject.color}"></span>${App.escapeHtml(subject.name)}</span>`;
    } else {
      subjBadge.innerHTML = `<span class="badge badge-muted">General Study Note</span>`;
    }
  }

  // Metadata
  const timeEl = App.qs('#detailTimestamp');
  if (timeEl) {
    timeEl.textContent = timestamp ? `Updated ${Dates.formatFull(timestamp)} (${Dates.timeAgo(timestamp)})` : 'Recently updated';
  }

  const statsEl = App.qs('#detailStats');
  if (statsEl) {
    statsEl.textContent = `${words} words · ${readTime} min read`;
  }

  // Formatted Body (preserves linebreaks, tabs, bulleted outlines)
  const contentEl = App.qs('#detailNoteContent');
  if (contentEl) {
    contentEl.textContent = note.content;
  }

  // Update Pin Button text in modal foot
  const pinBtnLabel = App.qs('#detailPinBtnLabel');
  if (pinBtnLabel) {
    pinBtnLabel.textContent = note.pinned ? '📌 Unpin' : '📌 Pin to top';
  }

  App.openModal('#noteDetailModal');
}

/* ==========================================================================
   Empty states
   ========================================================================== */
function renderEmptyState(totalNotes, subjectsMap) {
  if (totalNotes === 0) {
    return `
      <div class="empty" style="grid-column:1/-1">
        <div class="empty__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>
        </div>
        <h3>No study notes yet</h3>
        <p>Capture your first study note to summarize chapters, formulas, and key revision topics.</p>
        <button type="button" class="btn btn-primary mt-4" data-empty-add>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
          Add Your First Note
        </button>
      </div>`;
  }

  if (view.filter === 'pinned' && !view.search && !view.subject) {
    return `
      <div class="empty" style="grid-column:1/-1">
        <div class="empty__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h20"/><path d="M12 18v4"/><path d="m19.07 10.93-1.41 1.41"/></svg>
        </div>
        <h3>No pinned notes yet</h3>
        <p>Pin formula sheets, exam cheat sheets, and high-priority revision notes to keep them at the top.</p>
        <button type="button" class="btn btn-ghost mt-4" data-empty-view-all>
          View All Notes
        </button>
      </div>`;
  }

  if (view.subject && !view.search) {
    const subj = subjectsMap[view.subject];
    const subjName = subj ? subj.name : 'this subject';
    return `
      <div class="empty" style="grid-column:1/-1">
        <div class="empty__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>
        </div>
        <h3>No notes yet for ${App.escapeHtml(subjName)}</h3>
        <p>Create a study summary or formula sheet for ${App.escapeHtml(subjName)}.</p>
        <div class="flex gap-2 justify-center mt-4">
          <button type="button" class="btn btn-primary" data-empty-add-subject>
            + Add Note for ${App.escapeHtml(subjName)}
          </button>
          <button type="button" class="btn btn-ghost" data-empty-clear-filter>
            Show All Subjects
          </button>
        </div>
      </div>`;
  }

  return `
    <div class="empty" style="grid-column:1/-1">
      <div class="empty__icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      </div>
      <h3>No matching notes found</h3>
      <p>No notes matched your search query${view.search ? ` "<b>${App.escapeHtml(view.search)}</b>"` : ''}. Try another term or clear active filters.</p>
      <button type="button" class="btn btn-ghost mt-4" data-empty-clear-all>
        Clear Search & Filters
      </button>
    </div>`;
}

function wireEmptyStateActions() {
  const addBtn = App.qs('[data-empty-add]');
  if (addBtn) addBtn.addEventListener('click', () => openNoteModal(null, view.subject));

  const addSubjBtn = App.qs('[data-empty-add-subject]');
  if (addSubjBtn) addSubjBtn.addEventListener('click', () => openNoteModal(null, view.subject));

  const viewAllBtn = App.qs('[data-empty-view-all]');
  if (viewAllBtn) {
    viewAllBtn.addEventListener('click', () => {
      view.filter = 'all';
      updateFilterPillUI();
      render();
    });
  }

  const clearFilterBtn = App.qs('[data-empty-clear-filter]');
  if (clearFilterBtn) {
    clearFilterBtn.addEventListener('click', () => {
      view.subject = '';
      const select = App.qs('#filterNoteSubject');
      if (select) select.value = '';
      render();
    });
  }

  const clearAllBtn = App.qs('[data-empty-clear-all]');
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', () => {
      view.search = '';
      view.subject = '';
      view.filter = 'all';
      const input = App.qs('#noteSearch');
      if (input) input.value = '';
      const select = App.qs('#filterNoteSubject');
      if (select) select.value = '';
      updateFilterPillUI();
      render();
    });
  }
}

if (typeof window !== 'undefined') {
  window.StudyFlowNotes = {
    view,
    isUUID,
    isCloudNote,
    repoForActiveNote,
    resolveCloudSubjectId,
    resolveSubjectForDisplay,
    getAllAvailableSubjects,
    populateNoteModalSubjects,
    populateSubjectDropdowns,
    getSubjectsMapForRender,
    handleSubmitNote,
    openNoteModal
  };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    view,
    isUUID,
    isCloudNote,
    repoForActiveNote,
    resolveCloudSubjectId,
    resolveSubjectForDisplay,
    getAllAvailableSubjects,
    populateNoteModalSubjects,
    populateSubjectDropdowns,
    getSubjectsMapForRender,
    handleSubmitNote,
    openNoteModal
  };
}
