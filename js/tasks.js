/* ==========================================================================
   tasks.js — Tasks page logic
   Features: Add · Edit · Delete · Complete · Search · Filter by subject ·
   Filter by status · Sort by due date/priority · Form validation.
   ========================================================================== */

// Current view state driven by the toolbar controls.
const view = { search: '', subject: '', status: 'all', sort: 'due-asc' };

document.addEventListener('DOMContentLoaded', () => {
  populateSubjectDropdowns();
  bindToolbar();
  bindModal();
  render();
});

/* ==========================================================================
   Populate the subject <select>s (toolbar filter + the form)
   ========================================================================== */
function populateSubjectDropdowns() {
  const subjects = Store.getSubjects();
  const options = subjects.map(s => `<option value="${s.id}">${App.escapeHtml(s.name)}</option>`).join('');

  App.qs('#filterSubject').insertAdjacentHTML('beforeend', options);
  App.qs('#taskSubject').insertAdjacentHTML('beforeend', options);
}

/* ==========================================================================
   Toolbar wiring — search (debounced), filters, sort
   ========================================================================== */
function bindToolbar() {
  App.qs('#searchInput').addEventListener('input', App.debounce(e => {
    view.search = e.target.value.trim().toLowerCase();
    render();
  }, 200));

  App.qs('#filterSubject').addEventListener('change', e => { view.subject = e.target.value; render(); });
  App.qs('#filterStatus').addEventListener('change', e => { view.status = e.target.value; render(); });
  App.qs('#sortBy').addEventListener('change', e => { view.sort = e.target.value; render(); });

  App.qs('#addTaskBtn').addEventListener('click', () => openTaskModal());
}

/* ==========================================================================
   Filtering + sorting pipeline, then render the list
   ========================================================================== */
function getVisibleTasks() {
  let tasks = Store.getTasks();

  // 1) Search — match against title and notes.
  if (view.search) {
    tasks = tasks.filter(t =>
      t.title.toLowerCase().includes(view.search) ||
      (t.notes || '').toLowerCase().includes(view.search));
  }

  // 2) Filter by subject.
  if (view.subject) tasks = tasks.filter(t => t.subjectId === view.subject);

  // 3) Filter by status.
  if (view.status === 'active')    tasks = tasks.filter(t => !t.completed);
  if (view.status === 'completed') tasks = tasks.filter(t => t.completed);

  // 4) Sort.
  const priorityRank = { high: 0, medium: 1, low: 2 };
  tasks.sort((a, b) => {
    switch (view.sort) {
      case 'due-desc':  return (b.dueDate || '').localeCompare(a.dueDate || '');
      case 'priority':  return priorityRank[a.priority] - priorityRank[b.priority];
      case 'created':   return (b.createdAt || '').localeCompare(a.createdAt || '');
      case 'due-asc':
      default:          return (a.dueDate || '').localeCompare(b.dueDate || '');
    }
  });

  return tasks;
}

function render() {
  const tasks = getVisibleTasks();
  const list = App.qs('#taskList');
  const count = App.qs('#resultCount');
  const total = Store.getTasks().length;

  count.textContent = total === 0
    ? ''
    : `Showing ${tasks.length} of ${total} task${total === 1 ? '' : 's'}`;

  // Empty states — distinguish "no tasks at all" from "no matches".
  if (!tasks.length) {
    list.innerHTML = total === 0 ? emptyNoTasks() : emptyNoMatches();
    wireEmptyStateButton();
    return;
  }

  list.innerHTML = tasks.map(taskCardHTML).join('');
  wireTaskCards();
}

/* ==========================================================================
   Render a single task card
   ========================================================================== */
function taskCardHTML(t) {
  const subject = Store.getSubject(t.subjectId);
  const days = Dates.daysFromToday(t.dueDate);

  // Due-date styling: overdue (red) / due soon (amber) when still active.
  let dueClass = '';
  if (!t.completed && days !== null) {
    if (days < 0) dueClass = 'due-overdue';
    else if (days <= 2) dueClass = 'due-soon';
  }

  return `
    <div class="task-item pri-${t.priority} ${t.completed ? 'done' : ''}" data-id="${t.id}">
      <input type="checkbox" class="check" data-toggle ${t.completed ? 'checked' : ''} title="Mark complete" />
      <div class="task-item__body">
        <div class="task-item__title">${App.escapeHtml(t.title)}</div>
        <div class="task-item__meta">
          ${subject ? `<span class="badge badge-muted"><span class="dot" style="background:${subject.color}"></span>${App.escapeHtml(subject.name)}</span>` : ''}
          <span class="badge badge-muted priority-${t.priority}">● ${t.priority}</span>
          <span class="${dueClass}">${dueIcon()} ${Dates.formatFull(t.dueDate)} · ${Dates.relative(t.dueDate)}</span>
        </div>
        ${t.notes ? `<div class="task-item__notes">${App.escapeHtml(t.notes)}</div>` : ''}
      </div>
      <div class="task-item__actions">
        <button class="icon-btn" data-edit title="Edit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
        </button>
        <button class="icon-btn danger" data-delete title="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" /></svg>
        </button>
      </div>
    </div>`;
}

function dueIcon() {
  return `<svg style="width:13px;height:13px;display:inline;vertical-align:-2px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;
}

/* ==========================================================================
   Wire the buttons on each task card (complete / edit / delete)
   ========================================================================== */
function wireTaskCards() {
  App.qsa('.task-item').forEach(card => {
    const id = card.dataset.id;

    card.querySelector('[data-toggle]').addEventListener('change', () => {
      const done = Store.toggleTask(id);
      App.toast(done ? 'Task completed! 🎉' : 'Marked as active', done ? 'success' : 'info');
      render();
    });

    card.querySelector('[data-edit]').addEventListener('click', () => openTaskModal(id));

    card.querySelector('[data-delete]').addEventListener('click', () => {
      const task = Store.getTask(id);
      App.confirm({
        title: 'Delete task?',
        message: `"${task.title}" will be permanently removed.`,
        confirmText: 'Delete',
        onConfirm: () => { Store.deleteTask(id); App.toast('Task deleted', 'info'); render(); }
      });
    });
  });
}

/* ==========================================================================
   Add / Edit modal
   ========================================================================== */
function bindModal() {
  const modal = App.qs('#taskModal');
  App.bindModalClose(modal);
  App.qs('#taskForm').addEventListener('submit', handleSubmit);

  // Clear a field's error state as soon as the user corrects it.
  ['taskTitle', 'taskDue'].forEach(id => {
    App.qs('#' + id).addEventListener('input', e => e.target.closest('.field').classList.remove('invalid'));
  });
}

function openTaskModal(id = null) {
  const form = App.qs('#taskForm');
  form.reset();
  App.qsa('.field').forEach(f => f.classList.remove('invalid'));

  if (id) {
    // Edit — prefill from the stored task.
    const t = Store.getTask(id);
    App.qs('#taskModalTitle').textContent = 'Edit Task';
    App.qs('#taskId').value = t.id;
    App.qs('#taskTitle').value = t.title;
    App.qs('#taskSubject').value = t.subjectId || '';
    App.qs('#taskPriority').value = t.priority;
    App.qs('#taskDue').value = t.dueDate;
    App.qs('#taskNotes').value = t.notes || '';
  } else {
    // Add — sensible defaults (due today).
    App.qs('#taskModalTitle').textContent = 'Add Task';
    App.qs('#taskId').value = '';
    App.qs('#taskDue').value = Dates.todayISO();
  }
  App.openModal('#taskModal');
}

/* ==========================================================================
   Form validation + save
   ========================================================================== */
function handleSubmit(e) {
  e.preventDefault();

  const title = App.qs('#taskTitle').value.trim();
  const due = App.qs('#taskDue').value;
  let valid = true;

  // Rule 1: title required, min 2 chars.
  if (title.length < 2) { markInvalid('f-title'); valid = false; }
  // Rule 2: due date required.
  if (!due) { markInvalid('f-due'); valid = false; }

  if (!valid) { App.toast('Please fix the highlighted fields', 'error'); return; }

  const data = {
    title,
    subjectId: App.qs('#taskSubject').value,
    priority: App.qs('#taskPriority').value,
    dueDate: due,
    notes: App.qs('#taskNotes').value.trim()
  };

  const id = App.qs('#taskId').value;
  if (id) data.id = id;   // presence of id → update

  Store.saveTask(data);
  App.closeModal('#taskModal');
  App.toast(id ? 'Task updated' : 'Task added', 'success');
  render();
}

function markInvalid(fieldId) { App.qs('#' + fieldId).classList.add('invalid'); }

/* ==========================================================================
   Empty states
   ========================================================================== */
function emptyNoTasks() {
  return `
    <div class="empty">
      <div class="empty__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div>
      <h3>No tasks yet</h3>
      <p>Create your first task to start planning your studies.</p>
      <button class="btn btn-primary mt-4" data-empty-add>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> Add Task
      </button>
    </div>`;
}

function emptyNoMatches() {
  return `
    <div class="empty">
      <div class="empty__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></div>
      <h3>No matching tasks</h3>
      <p>Try adjusting your search or filters.</p>
    </div>`;
}

function wireEmptyStateButton() {
  const btn = App.qs('[data-empty-add]');
  if (btn) btn.addEventListener('click', () => openTaskModal());
}
