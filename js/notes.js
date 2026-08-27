/* ==========================================================================
   notes.js — Notes page logic
   Features: Add · Edit · Delete · Search · link to subject · validation.
   ========================================================================== */

let noteSearch = '';

document.addEventListener('DOMContentLoaded', () => {
  populateSubjectDropdown();
  bindModal();
  App.qs('#addNoteBtn').addEventListener('click', () => openNoteModal());
  App.qs('#noteSearch').addEventListener('input', App.debounce(e => {
    noteSearch = e.target.value.trim().toLowerCase();
    render();
  }, 200));
  render();
});

function populateSubjectDropdown() {
  const options = Store.getSubjects()
    .map(s => `<option value="${s.id}">${App.escapeHtml(s.name)}</option>`).join('');
  App.qs('#noteSubject').insertAdjacentHTML('beforeend', options);
}

/* ==========================================================================
   Render the notes grid (with search filter)
   ========================================================================== */
function render() {
  let notes = Store.getNotes();

  if (noteSearch) {
    notes = notes.filter(n =>
      n.title.toLowerCase().includes(noteSearch) ||
      n.content.toLowerCase().includes(noteSearch));
  }

  // Most recently updated first.
  notes.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  const grid = App.qs('#notesGrid');
  const totalNotes = Store.getNotes().length;

  if (!notes.length) {
    grid.innerHTML = totalNotes === 0 ? emptyNoNotes() : emptyNoMatches();
    const b = App.qs('[data-empty-add]');
    if (b) b.addEventListener('click', () => openNoteModal());
    return;
  }

  grid.innerHTML = notes.map(n => {
    const subject = Store.getSubject(n.subjectId);
    return `
      <article class="note-card" data-id="${n.id}">
        <div class="note-card__head">
          <h3>${App.escapeHtml(n.title)}</h3>
          <div class="task-item__actions">
            <button class="icon-btn" data-edit title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
            <button class="icon-btn danger" data-delete title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg></button>
          </div>
        </div>
        ${subject ? `<span class="badge badge-muted" style="align-self:flex-start;margin-bottom:var(--space-2)"><span class="dot" style="background:${subject.color}"></span>${App.escapeHtml(subject.name)}</span>` : ''}
        <div class="note-card__content">${App.escapeHtml(n.content)}</div>
        <div class="note-card__foot">
          <span>Updated ${Dates.relative(dateOnly(n.updatedAt))}</span>
          <span>${countWords(n.content)} words</span>
        </div>
      </article>`;
  }).join('');

  wireCards();
}

/* Extract 'YYYY-MM-DD' from an ISO timestamp for relative formatting. */
function dateOnly(isoTimestamp) { return (isoTimestamp || '').slice(0, 10); }
function countWords(text) { return text.trim() ? text.trim().split(/\s+/).length : 0; }

/* ==========================================================================
   Card actions
   ========================================================================== */
function wireCards() {
  App.qsa('.note-card').forEach(card => {
    const id = card.dataset.id;
    card.querySelector('[data-edit]').addEventListener('click', () => openNoteModal(id));
    card.querySelector('[data-delete]').addEventListener('click', () => {
      const note = Store.getNote(id);
      App.confirm({
        title: 'Delete note?',
        message: `"${note.title}" will be permanently removed.`,
        confirmText: 'Delete',
        onConfirm: () => { Store.deleteNote(id); App.toast('Note deleted', 'info'); render(); }
      });
    });
  });
}

/* ==========================================================================
   Add / Edit modal
   ========================================================================== */
function bindModal() {
  App.bindModalClose('#noteModal');
  App.qs('#noteForm').addEventListener('submit', handleSubmit);
  ['noteTitle', 'noteContent'].forEach(id =>
    App.qs('#' + id).addEventListener('input', e => e.target.closest('.field').classList.remove('invalid')));
}

function openNoteModal(id = null) {
  const form = App.qs('#noteForm');
  form.reset();
  App.qsa('.field').forEach(f => f.classList.remove('invalid'));

  if (id) {
    const n = Store.getNote(id);
    App.qs('#noteModalTitle').textContent = 'Edit Note';
    App.qs('#noteId').value = n.id;
    App.qs('#noteTitle').value = n.title;
    App.qs('#noteSubject').value = n.subjectId || '';
    App.qs('#noteContent').value = n.content;
  } else {
    App.qs('#noteModalTitle').textContent = 'Add Note';
    App.qs('#noteId').value = '';
  }
  App.openModal('#noteModal');
}

function handleSubmit(e) {
  e.preventDefault();
  const title = App.qs('#noteTitle').value.trim();
  const content = App.qs('#noteContent').value.trim();
  let valid = true;

  if (title.length < 1)   { App.qs('#fn-title').classList.add('invalid');   valid = false; }
  if (content.length < 1) { App.qs('#fn-content').classList.add('invalid'); valid = false; }
  if (!valid) { App.toast('Please fill in the required fields', 'error'); return; }

  const data = { title, content, subjectId: App.qs('#noteSubject').value };
  const id = App.qs('#noteId').value;
  if (id) data.id = id;

  Store.saveNote(data);
  App.closeModal('#noteModal');
  App.toast(id ? 'Note updated' : 'Note added', 'success');
  render();
}

/* ==========================================================================
   Empty states
   ========================================================================== */
function emptyNoNotes() {
  return `
    <div class="empty" style="grid-column:1/-1">
      <div class="empty__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg></div>
      <h3>No notes yet</h3>
      <p>Capture your first study note to keep everything in one place.</p>
      <button class="btn btn-primary mt-4" data-empty-add><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> Add Note</button>
    </div>`;
}
function emptyNoMatches() {
  return `
    <div class="empty" style="grid-column:1/-1">
      <div class="empty__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></div>
      <h3>No notes found</h3>
      <p>Try a different search term.</p>
    </div>`;
}
