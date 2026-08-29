/* ==========================================================================
   tasks.js — Tasks page logic
   Features: Add · Edit · Delete · Complete · Search · Filter by subject ·
   Filter by status (All, Active, Completed, Overdue) · Filter by priority ·
   Filter by category · Sort by due date/priority/created/title · Form validation.
   ========================================================================== */

// Current view state driven by toolbar controls
const view = {
  search: '',
  subject: '',
  status: 'all',
  priority: 'all',
  category: 'all',
  sort: 'due-asc'
};

document.addEventListener('DOMContentLoaded', () => {
  readUrlParams();
  populateDropdowns();
  bindToolbar();
  bindModal();
  render();
});

/* Read URL parameters (e.g. from Global Search or Subject page links) */
function readUrlParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('search')) {
    view.search = params.get('search').toLowerCase();
    const input = App.qs('#searchInput');
    if (input) input.value = params.get('search');
  }
  if (params.has('subject')) {
    view.subject = params.get('subject');
  }
  if (params.has('status')) {
    view.status = params.get('status');
  }
}

/* ==========================================================================
   Populate the subject & category dropdowns
   ========================================================================== */
function populateDropdowns() {
  // 1. Subjects
  const subjects = Store.getSubjects();
  const subOptions = subjects.map(s => `<option value="${s.id}">${App.escapeHtml(s.name)}</option>`).join('');

  App.qs('#filterSubject').insertAdjacentHTML('beforeend', subOptions);
  App.qs('#taskSubject').insertAdjacentHTML('beforeend', subOptions);

  if (view.subject) {
    App.qs('#filterSubject').value = view.subject;
  }

  // 2. Categories
  const catOptions = Store.TASK_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('');
  App.qs('#filterCategory').insertAdjacentHTML('beforeend', catOptions);

  if (view.status) {
    App.qs('#filterStatus').value = view.status;
  }
}

/* ==========================================================================
   Toolbar wiring — search (debounced), filters, sort
   ========================================================================== */
function bindToolbar() {
  App.qs('#searchInput').addEventListener('input', App.debounce(e => {
    view.search = e.target.value.trim().toLowerCase();
    render();
  }, 150));

  App.qs('#filterSubject').addEventListener('change', e => { view.subject = e.target.value; render(); });
  App.qs('#filterStatus').addEventListener('change', e => { view.status = e.target.value; render(); });
  App.qs('#filterPriority').addEventListener('change', e => { view.priority = e.target.value; render(); });
  App.qs('#filterCategory').addEventListener('change', e => { view.category = e.target.value; render(); });
  App.qs('#sortBy').addEventListener('change', e => { view.sort = e.target.value; render(); });

  App.qs('#addTaskBtn').addEventListener('click', () => openTaskModal());
}

/* ==========================================================================
   Filtering + sorting pipeline, then render the list
   ========================================================================== */
function getVisibleTasks() {
  let tasks = Store.getTasks();
  const today = Dates.todayISO();

  // 1) Search — match against title and notes
  if (view.search) {
    tasks = tasks.filter(t =>
      t.title.toLowerCase().includes(view.search) ||
      (t.notes || '').toLowerCase().includes(view.search) ||
      (t.category || '').toLowerCase().includes(view.search));
  }

  // 2) Filter by subject
  if (view.subject) tasks = tasks.filter(t => t.subjectId === view.subject);

  // 3) Filter by status
  if (view.status === 'active')    tasks = tasks.filter(t => !t.completed);
  if (view.status === 'completed') tasks = tasks.filter(t => t.completed);
  if (view.status === 'overdue')   tasks = tasks.filter(t => !t.completed && t.dueDate && t.dueDate < today);

  // 4) Filter by priority
  if (view.priority !== 'all') tasks = tasks.filter(t => t.priority === view.priority);

  // 5) Filter by category
  if (view.category !== 'all') tasks = tasks.filter(t => (t.category || 'General') === view.category);

  // 6) Sort
  const priorityRank = { high: 0, medium: 1, low: 2 };
  tasks.sort((a, b) => {
    switch (view.sort) {
      case 'due-desc':  return (b.dueDate || '').localeCompare(a.dueDate || '');
      case 'priority':  return priorityRank[a.priority] - priorityRank[b.priority];
      case 'created':   return (b.createdAt || '').localeCompare(a.createdAt || '');
      case 'title':     return (a.title || '').localeCompare(b.title || '');
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

  // Empty states
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

  // Due-date status classes
  let dueClass = '';
  let statusBadge = '';
  let cardClass = `task-item pri-${t.priority}`;

  if (t.completed) {
    cardClass += ' done';
    statusBadge = `<span class="badge badge-success">✓ Completed</span>`;
  } else if (days !== null) {
    if (days < 0) {
      dueClass = 'due-overdue';
      cardClass += ' is-overdue';
      statusBadge = `<span class="badge badge-overdue">⚠️ Overdue (${Math.abs(days)}d)</span>`;
    } else if (days === 0) {
      dueClass = 'due-soon';
      cardClass += ' is-today';
      statusBadge = `<span class="badge badge-warning">Due Today</span>`;
    } else if (days === 1) {
      statusBadge = `<span class="badge badge-muted">Due Tomorrow</span>`;
    }
  }

  return `
    <div class="${cardClass}" data-id="${t.id}">
      <input type="checkbox" class="check" data-toggle ${t.completed ? 'checked' : ''} aria-label="Mark task complete" />
      <div class="task-item__body">
        <div class="flex-between wrap gap-2" style="margin-bottom:4px">
          <div class="task-item__title">${App.escapeHtml(t.title)}</div>
          <div class="flex gap-2">${statusBadge}</div>
        </div>

        <div class="task-item__meta">
          ${subject ? `<span class="badge badge-muted"><span class="dot" style="background:${subject.color}"></span>${App.escapeHtml(subject.name)}</span>` : ''}
          <span class="badge badge-muted priority-${t.priority}">● ${t.priority}</span>
          ${t.category && t.category !== 'General' ? `<span class="badge badge-category">${App.escapeHtml(t.category)}</span>` : ''}
          ${t.estimate ? `<span class="badge badge-estimate">⏱️ ${Dates.formatDuration(t.estimate)}</span>` : ''}
          <span class="${dueClass}">${dueIcon()} ${Dates.formatFull(t.dueDate)} · ${Dates.relative(t.dueDate)}</span>
        </div>

        ${t.notes ? `<div class="task-item__notes">${App.escapeHtml(t.notes)}</div>` : ''}
      </div>

      <div class="task-item__actions">
        ${t.completed ? '' : `<a href="timer.html?taskId=${t.id}${t.subjectId ? `&subjectId=${t.subjectId}` : ''}&autostart=1" class="icon-btn" title="Start a focus session for this task" aria-label="Start a focus session for &quot;${App.escapeHtml(t.title)}&quot;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </a>`}
        <button class="icon-btn" data-edit title="Edit Task" aria-label="Edit &quot;${App.escapeHtml(t.title)}&quot;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
        </button>
        <button class="icon-btn danger" data-delete title="Delete Task" aria-label="Delete &quot;${App.escapeHtml(t.title)}&quot;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" /></svg>
        </button>
      </div>
    </div>`;
}

function dueIcon() {
  return `<svg style="width:13px;height:13px;display:inline;vertical-align:-2px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;
}

/* ==========================================================================
   Wire buttons on each task card
   ========================================================================== */
function wireTaskCards() {
  App.qsa('.task-item').forEach(card => {
    const id = card.dataset.id;

    card.querySelector('[data-toggle]').addEventListener('change', () => {
      const done = Store.toggleTask(id);
      if (done) App.playChime('finish');
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

  ['taskTitle', 'taskDue'].forEach(id => {
    App.qs('#' + id).addEventListener('input', e => e.target.closest('.field').classList.remove('invalid'));
  });
}

function openTaskModal(id = null) {
  const form = App.qs('#taskForm');
  form.reset();
  App.qsa('.field').forEach(f => f.classList.remove('invalid'));

  if (id) {
    // Edit mode
    const t = Store.getTask(id);
    App.qs('#taskModalTitle').textContent = 'Edit Task';
    App.qs('#taskId').value = t.id;
    App.qs('#taskTitle').value = t.title;
    App.qs('#taskSubject').value = t.subjectId || '';
    App.qs('#taskCategory').value = t.category || 'Assignment';
    App.qs('#taskPriority').value = t.priority || 'medium';
    App.qs('#taskDue').value = t.dueDate;
    App.qs('#taskEstimate').value = t.estimate || '';
    App.qs('#taskNotes').value = t.notes || '';
  } else {
    // Add mode
    App.qs('#taskModalTitle').textContent = 'Add Task';
    App.qs('#taskId').value = '';
    App.qs('#taskDue').value = Dates.todayISO();
    App.qs('#taskCategory').value = 'Assignment';
    App.qs('#taskPriority').value = 'medium';
    if (view.subject) {
      App.qs('#taskSubject').value = view.subject;
    }
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

  if (title.length < 2) { markInvalid('f-title'); valid = false; }
  if (!due) { markInvalid('f-due'); valid = false; }

  if (!valid) { App.toast('Please fix the highlighted fields', 'error'); return; }

  const data = {
    title,
    subjectId: App.qs('#taskSubject').value,
    category: App.qs('#taskCategory').value,
    priority: App.qs('#taskPriority').value,
    dueDate: due,
    estimate: Number(App.qs('#taskEstimate').value) || 0,
    notes: App.qs('#taskNotes').value.trim()
  };

  const id = App.qs('#taskId').value;
  if (id) data.id = id;

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
      <p>Create your first task to start organizing your studies.</p>
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
      <p>Try adjusting your search query, priority, category or status filters.</p>
    </div>`;
}

function wireEmptyStateButton() {
  const btn = App.qs('[data-empty-add]');
  if (btn) btn.addEventListener('click', () => openTaskModal());
}
