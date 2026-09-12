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
  activeDetailId: null
};

document.addEventListener('DOMContentLoaded', () => {
  readUrlParams();
  populateSubjectDropdowns();
  bindToolbar();
  bindModals();
  render();
  handleUrlDeepLinks();
});

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
    const note = Store.getNote(noteId);
    if (note) {
      openNoteDetailModal(noteId);
    } else {
      App.toast('Note not found or may have been deleted', 'error');
    }
  }
}

/* ==========================================================================
   Subject dropdowns
   ========================================================================== */
function populateSubjectDropdowns() {
  const subjects = Store.getSubjects();
  const options = subjects.map(s => `<option value="${s.id}">${App.escapeHtml(s.name)}</option>`).join('');

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
   Render main view
   ========================================================================== */
function render() {
  const allNotes = Store.getNotes();
  const allSubjects = Store.getSubjects();
  const subjectsMap = {};
  allSubjects.forEach(s => { subjectsMap[s.id] = s; });

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
    grid.innerHTML = renderEmptyState(allNotes.length, subjectsMap);
    wireEmptyStateActions();
    return;
  }

  // Render note cards
  grid.innerHTML = visibleNotes.map(n => {
    const subject = subjectsMap[n.subjectId];
    const words = countWords(n.content);
    const readTime = Math.max(1, Math.ceil(words / 150));
    const timestamp = n.updatedAt || n.createdAt;

    const renderedTitle = view.search ? highlightText(n.title, view.search) : App.escapeHtml(n.title);
    const renderedContent = view.search ? highlightText(n.content, view.search) : App.escapeHtml(n.content);

    return `
      <article class="note-card ${n.pinned ? 'note-card--pinned' : ''}" data-id="${n.id}" tabindex="0" role="listitem" aria-label="Note: ${App.escapeHtml(n.title)}">
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

    // Card click opens detail modal
    card.addEventListener('click', () => openNoteDetailModal(id));

    // Keyboard navigation: Enter or Space opens detail modal
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openNoteDetailModal(id);
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
        const newPinned = Store.togglePinNote(id);
        App.toast(newPinned ? 'Note pinned to top 📌' : 'Note unpinned', 'info');
        render();
      });
    }

    // Copy note
    const copyBtn = card.querySelector('[data-copy]');
    if (copyBtn) {
      copyBtn.addEventListener('click', e => {
        e.stopPropagation();
        const note = Store.getNote(id);
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
        openNoteModal(id);
      });
    }

    // Delete note
    const deleteBtn = card.querySelector('[data-delete]');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', e => {
        e.stopPropagation();
        const note = Store.getNote(id);
        if (!note) return;
        App.confirm({
          title: 'Delete note?',
          message: `"${note.title}" will be permanently removed.`,
          confirmText: 'Delete',
          onConfirm: () => {
            Store.deleteNote(id);
            App.toast('Note deleted', 'info');
            render();
          }
        });
      });
    }
  });
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
      if (!view.activeDetailId) return;
      const note = Store.getNote(view.activeDetailId);
      if (note && navigator.clipboard) {
        navigator.clipboard.writeText(`${note.title}\n\n${note.content}`)
          .then(() => App.toast('Note copied to clipboard!', 'success'))
          .catch(() => App.toast('Could not copy note', 'error'));
      }
    });
  }

  const detailPinBtn = App.qs('#detailPinBtn');
  if (detailPinBtn) {
    detailPinBtn.addEventListener('click', () => {
      if (!view.activeDetailId) return;
      const isPinned = Store.togglePinNote(view.activeDetailId);
      App.toast(isPinned ? 'Note pinned to top 📌' : 'Note unpinned', 'info');
      openNoteDetailModal(view.activeDetailId);
      render();
    });
  }

  const detailEditBtn = App.qs('#detailEditBtn');
  if (detailEditBtn) {
    detailEditBtn.addEventListener('click', () => {
      const noteId = view.activeDetailId;
      App.closeModal('#noteDetailModal');
      if (noteId) openNoteModal(noteId);
    });
  }

  const detailDeleteBtn = App.qs('#detailDeleteBtn');
  if (detailDeleteBtn) {
    detailDeleteBtn.addEventListener('click', () => {
      if (!view.activeDetailId) return;
      const note = Store.getNote(view.activeDetailId);
      if (!note) return;

      App.confirm({
        title: 'Delete note?',
        message: `"${note.title}" will be permanently removed.`,
        confirmText: 'Delete',
        onConfirm: () => {
          Store.deleteNote(view.activeDetailId);
          App.closeModal('#noteDetailModal');
          view.activeDetailId = null;
          App.toast('Note deleted', 'info');
          render();
        }
      });
    });
  }
}

/* ==========================================================================
   Open Add / Edit Modal
   ========================================================================== */
function openNoteModal(id = null, preselectedSubjectId = null) {
  const form = App.qs('#noteForm');
  if (!form) return;
  form.reset();
  App.qsa('.field').forEach(f => f.classList.remove('invalid'));

  if (id) {
    const n = Store.getNote(id);
    if (!n) {
      App.toast('Note not found', 'error');
      return;
    }
    App.qs('#noteModalTitle').textContent = 'Edit Note';
    App.qs('#noteId').value = n.id;
    App.qs('#noteTitle').value = n.title;
    App.qs('#noteSubject').value = n.subjectId || '';
    App.qs('#noteContent').value = n.content;
    App.qs('#notePinned').checked = Boolean(n.pinned);
    App.qs('#modalWordCount').textContent = `${countWords(n.content)} words`;
  } else {
    App.qs('#noteModalTitle').textContent = 'Add Note';
    App.qs('#noteId').value = '';
    App.qs('#noteSubject').value = preselectedSubjectId || view.subject || '';
    App.qs('#noteContent').value = '';
    App.qs('#notePinned').checked = view.filter === 'pinned';
    App.qs('#modalWordCount').textContent = '0 words';
  }

  App.openModal('#noteModal');
}

/* ==========================================================================
   Handle Note Form Submission
   ========================================================================== */
function handleSubmitNote(e) {
  if (e && e.preventDefault) e.preventDefault();
  const title = App.qs('#noteTitle').value.trim();
  const content = App.qs('#noteContent').value.trim();
  let valid = true;

  if (title.length < 1) {
    App.qs('#fn-title').classList.add('invalid');
    valid = false;
  }
  if (content.length < 1) {
    App.qs('#fn-content').classList.add('invalid');
    valid = false;
  }
  if (!valid) {
    App.toast('Please fill in the required fields', 'error');
    return;
  }

  const id = App.qs('#noteId').value;
  const data = {
    title,
    content,
    subjectId: App.qs('#noteSubject').value,
    pinned: App.qs('#notePinned').checked
  };
  if (id) data.id = id;

  Store.saveNote(data);
  App.closeModal('#noteModal');
  App.toast(id ? 'Note updated' : 'Note created successfully', 'success');
  render();
}

/* ==========================================================================
   Open Note Detail Reading Modal
   ========================================================================== */
function openNoteDetailModal(id) {
  const note = Store.getNote(id);
  if (!note) {
    App.toast('Note not found', 'error');
    return;
  }

  view.activeDetailId = id;
  const subject = Store.getSubject(note.subjectId);
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

