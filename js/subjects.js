/* ==========================================================================
   subjects.js — Subjects page logic
   Features: Add · Edit · Delete (with safe unlink) · color picker ·
   per-subject task counts, overdue counts, notes count, study time & progress ·
   exam countdown · quick actions.
   ========================================================================== */

const COLORS = ['#7c3aed', '#2563eb', '#0d9488', '#db2777', '#ea580c', '#16a34a', '#dc2626', '#0891b2'];
let selectedColor = COLORS[0];

document.addEventListener('DOMContentLoaded', () => {
  buildSwatches();
  bindModal();
  App.qs('#addSubjectBtn').addEventListener('click', () => openSubjectModal());
  render();
  focusSubjectFromUrl();
});

/* When arriving from global search (?focus=<id>), scroll to and briefly
   highlight the matching subject card. */
function focusSubjectFromUrl() {
  const id = new URLSearchParams(location.search).get('focus');
  if (!id) return;
  const card = App.qs(`.subject-card[data-id="${CSS.escape(id)}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.add('flash');
  setTimeout(() => card.classList.remove('flash'), 1600);
}

/* ==========================================================================
   Render the grid of subject cards
   ========================================================================== */
function render() {
  const subjects = Store.getSubjectProgress();
  const grid = App.qs('#subjectsGrid');

  if (!subjects.length) {
    grid.innerHTML = `
      <div class="empty" style="grid-column:1/-1">
        <div class="empty__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg></div>
        <h3>No subjects yet</h3>
        <p>Add your courses to start organizing tasks, notes, and study sessions.</p>
        <button class="btn btn-primary mt-4" data-empty-add><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> Add Subject</button>
      </div>`;
    const b = App.qs('[data-empty-add]');
    if (b) b.addEventListener('click', () => openSubjectModal());
    return;
  }

  grid.innerHTML = subjects.map((s, i) => {
    const initial = s.name.trim().charAt(0).toUpperCase();
    const examDays = s.examDate ? Dates.daysFromToday(s.examDate) : null;

    // Exam badge
    let examBadge = `<span class="badge badge-muted">No exam set</span>`;
    if (examDays !== null) {
      if (examDays > 0)        examBadge = `<span class="badge badge-primary">Exam in ${examDays} day${examDays === 1 ? '' : 's'}</span>`;
      else if (examDays === 0) examBadge = `<span class="badge badge-warning">Exam today!</span>`;
      else                      examBadge = `<span class="badge badge-muted">Exam passed</span>`;
    }

    return `
      <div class="subject-card" style="--delay:${i * 50}ms" data-id="${s.id}">
        <div class="subject-card__stripe" style="background:${s.color}"></div>
        <div class="flex-between">
          <div class="subject-card__icon" style="background:${s.color}">${App.escapeHtml(initial)}</div>
          <div class="task-item__actions">
            <button class="icon-btn" data-edit title="Edit Subject" aria-label="Edit ${App.escapeHtml(s.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
            <button class="icon-btn danger" data-delete title="Delete Subject" aria-label="Delete ${App.escapeHtml(s.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg></button>
          </div>
        </div>

        <h3>${App.escapeHtml(s.name)}</h3>
        <p class="text-muted" style="font-size:var(--fs-sm);margin-bottom:var(--space-2)">${s.teacher ? App.escapeHtml(s.teacher) : 'No instructor specified'}</p>

        <!-- Informative Badges -->
        <div class="flex wrap gap-2" style="margin-bottom:var(--space-3)">
          <span class="subject-badge-count">📝 ${s.notesCount} note${s.notesCount === 1 ? '' : 's'}</span>
          ${s.focusMinutes > 0 ? `<span class="subject-badge-count">⏱️ ${Dates.formatDuration(s.focusMinutes)} focus</span>` : ''}
          ${s.overdueTasks > 0 ? `<span class="badge badge-overdue">⚠️ ${s.overdueTasks} overdue</span>` : ''}
        </div>

        <div class="subject-card__stats">
          <div><b>${s.totalTasks}</b><small>tasks</small></div>
          <div><b>${s.doneTasks}</b><small>done</small></div>
          <div><b>${s.percent}%</b><small>progress</small></div>
        </div>

        <div class="bar"><div class="bar__fill" style="width:0; background:${s.color}"></div></div>

        <div class="subject-card__foot">
          ${examBadge}
          ${s.examDate ? `<small class="text-faint">${Dates.formatFull(s.examDate)}</small>` : ''}
        </div>

        <!-- Quick actions -->
        <div class="subject-card__actions">
          <a href="tasks.html?subject=${s.id}" class="btn btn-ghost btn-sm" style="flex:1">View Tasks</a>
          <a href="timer.html?subjectId=${s.id}" class="btn btn-ghost btn-sm" title="Focus session on this subject">⏱️ Focus</a>
          <a href="notes.html?subject=${s.id}" class="btn btn-ghost btn-sm" title="Notes for this subject">📝 Notes</a>
        </div>
      </div>`;
  }).join('');

  // Animate progress bars after paint
  requestAnimationFrame(() => {
    App.qsa('.subject-card').forEach((card, i) => {
      card.querySelector('.bar__fill').style.width = subjects[i].percent + '%';
    });
  });

  wireCards();
}

/* ==========================================================================
   Card actions
   ========================================================================== */
function wireCards() {
  App.qsa('.subject-card').forEach(card => {
    const id = card.dataset.id;
    card.querySelector('[data-edit]').addEventListener('click', () => openSubjectModal(id));
    card.querySelector('[data-delete]').addEventListener('click', () => {
      const subject = Store.getSubject(id);
      const taskCount = Store.getTasks().filter(t => t.subjectId === id).length;
      App.confirm({
        title: 'Delete subject?',
        message: `"${subject.name}" will be removed.` +
          (taskCount ? ` Its ${taskCount} task${taskCount === 1 ? '' : 's'} will be kept safely, unlinked from any subject.` : ''),
        confirmText: 'Delete',
        onConfirm: () => { Store.deleteSubject(id); App.toast('Subject deleted', 'info'); render(); }
      });
    });
  });
}

/* ==========================================================================
   Color swatches
   ========================================================================== */
function buildSwatches() {
  const wrap = App.qs('#colorSwatches');
  wrap.innerHTML = COLORS.map(c =>
    `<button type="button" class="swatch" data-color="${c}" style="background:${c}" aria-label="Select color ${c}"></button>`
  ).join('');

  wrap.addEventListener('click', e => {
    const sw = e.target.closest('.swatch');
    if (!sw) return;
    selectedColor = sw.dataset.color;
    highlightSwatch();
  });
}

function highlightSwatch() {
  App.qsa('.swatch').forEach(sw =>
    sw.classList.toggle('selected', sw.dataset.color === selectedColor));
}

/* ==========================================================================
   Add / Edit modal
   ========================================================================== */
function bindModal() {
  const modal = App.qs('#subjectModal');
  App.bindModalClose(modal);
  App.qs('#subjectForm').addEventListener('submit', handleSubmit);
  App.qs('#subjectName').addEventListener('input', e => e.target.closest('.field').classList.remove('invalid'));
}

function openSubjectModal(id = null) {
  const form = App.qs('#subjectForm');
  form.reset();
  App.qs('#fs-name').classList.remove('invalid');

  if (id) {
    const s = Store.getSubject(id);
    App.qs('#subjectModalTitle').textContent = 'Edit Subject';
    App.qs('#subjectId').value = s.id;
    App.qs('#subjectName').value = s.name;
    App.qs('#subjectTeacher').value = s.teacher || '';
    App.qs('#subjectExam').value = s.examDate || '';
    selectedColor = s.color || COLORS[0];
  } else {
    App.qs('#subjectModalTitle').textContent = 'Add Subject';
    App.qs('#subjectId').value = '';
    selectedColor = COLORS[0];
  }
  highlightSwatch();
  App.openModal('#subjectModal');
}

function handleSubmit(e) {
  e.preventDefault();
  const name = App.qs('#subjectName').value.trim();

  if (name.length < 1) {
    App.qs('#fs-name').classList.add('invalid');
    App.toast('Please enter a subject name', 'error');
    return;
  }

  const data = {
    name,
    color: selectedColor,
    teacher: App.qs('#subjectTeacher').value.trim(),
    examDate: App.qs('#subjectExam').value
  };
  const id = App.qs('#subjectId').value;
  if (id) data.id = id;

  Store.saveSubject(data);
  App.closeModal('#subjectModal');
  App.toast(id ? 'Subject updated' : 'Subject added', 'success');
  render();
}

