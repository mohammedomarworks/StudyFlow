/* ==========================================================================
   calendar.js — Calendar page logic
   Builds a monthly grid; plots tasks (subject color, priority, done status) and
   exams on their dates; supports month navigation and an interactive per-day modal.
   ========================================================================== */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

// Current view — start on the month containing today
const cal = { year: 0, month: 0, activeDayISO: null };

document.addEventListener('DOMContentLoaded', () => {
  const now = new Date();
  cal.year = now.getFullYear();
  cal.month = now.getMonth();

  App.qs('#calPrev').addEventListener('click', () => shiftMonth(-1));
  App.qs('#calNext').addEventListener('click', () => shiftMonth(1));
  App.qs('#calToday').addEventListener('click', () => {
    const n = new Date();
    cal.year = n.getFullYear();
    cal.month = n.getMonth();
    render();
  });
  App.bindModalClose('#dayModal');

  render();
});

function shiftMonth(delta) {
  cal.month += delta;
  if (cal.month < 0) { cal.month = 11; cal.year--; }
  else if (cal.month > 11) { cal.month = 0; cal.year++; }
  render();
}

/* ==========================================================================
   Gather events (tasks + exams) for a given ISO date
   ========================================================================== */
function eventsForDate(iso) {
  const tasks = Store.getTasks().filter(t => t.dueDate === iso);
  const exams = Store.getSubjects().filter(s => s.examDate === iso);
  return { tasks, exams };
}

/* ==========================================================================
   Render the month grid
   ========================================================================== */
function render() {
  App.qs('#calMonthLabel').textContent = `${MONTHS[cal.month]} ${cal.year}`;

  const firstWeekday = new Date(cal.year, cal.month, 1).getDay();     // 0=Sun
  const daysInMonth = new Date(cal.year, cal.month + 1, 0).getDate();
  const today = Dates.todayISO();
  const grid = App.qs('#calGrid');

  let cells = '';

  // Leading blanks so 1st day lands on the correct weekday
  for (let i = 0; i < firstWeekday; i++) cells += `<div class="cal-cell empty"></div>`;

  // One cell per day
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${cal.year}-${String(cal.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const { tasks, exams } = eventsForDate(iso);
    const isToday = iso === today;

    // Event chips
    const chips = [];
    exams.forEach(s => chips.push(`<div class="cal-event exam" title="Exam: ${App.escapeHtml(s.name)}">📚 ${App.escapeHtml(s.name)}</div>`));
    tasks.forEach(t => {
      const subj = Store.getSubject(t.subjectId);
      const color = subj ? subj.color : 'var(--primary)';
      const doneClass = t.completed ? 'style="opacity:0.6;text-decoration:line-through;background:' + color + '"' : 'style="background:' + color + '"';
      chips.push(`<div class="cal-event" ${doneClass} title="${App.escapeHtml(t.title)}">${t.completed ? '✓ ' : ''}${App.escapeHtml(t.title)}</div>`);
    });

    let shown = chips.slice(0, 3).join('');
    if (chips.length > 3) shown += `<div class="cal-event more">+${chips.length - 3} more</div>`;

    const count = tasks.length + exams.length;
    const label = `${Dates.formatFull(iso)}${count ? `, ${count} item${count === 1 ? '' : 's'}` : ', nothing scheduled'}`;

    cells += `
      <div class="cal-cell ${isToday ? 'today' : ''}" data-date="${iso}" role="button" tabindex="0" aria-label="${label}" title="View details for ${Dates.formatShort(iso)}">
        <span class="cal-cell__num">${day}</span>
        ${shown}
      </div>`;
  }

  grid.innerHTML = cells;

  // Click or keyboard (Enter/Space) opens the day detail modal.
  App.qsa('.cal-cell[data-date]', grid).forEach(cell => {
    cell.addEventListener('click', () => openDay(cell.dataset.date));
    cell.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDay(cell.dataset.date);
      }
    });
  });
}

/* ==========================================================================
   Day detail modal
   ========================================================================== */
function openDay(iso) {
  cal.activeDayISO = iso;
  const { tasks, exams } = eventsForDate(iso);

  App.qs('#dayModalTitle').textContent = Dates.formatLong(iso);

  let html = '';

  // Empty day
  if (!tasks.length && !exams.length) {
    html = `
      <div class="empty" style="padding:var(--space-5) 0">
        <div class="empty__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M9 11l3 3L22 4"/>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
          </svg>
        </div>
        <h3>Nothing scheduled</h3>
        <p>No tasks or exams are scheduled for this day.</p>
        <a href="tasks.html" class="btn btn-primary mt-4">Add Task in Tasks View</a>
      </div>`;
    App.qs('#dayModalBody').innerHTML = html;
    App.openModal('#dayModal');
    return;
  }

  // Exams
  if (exams.length) {
    html += `
      <h4 class="section-title" style="color:var(--danger)">Exams (${exams.length})</h4>
      <div class="list">`;

    html += exams.map(s => `
      <div class="list-item">
        <span class="dot" style="background:${s.color};width:14px;height:14px"></span>
        <div class="list-item__main">
          <div class="list-item__title">${App.escapeHtml(s.name)}</div>
          <div class="list-item__meta">
            <span>${s.teacher ? App.escapeHtml(s.teacher) : 'Exam day'}</span>
          </div>
        </div>
        <span class="badge badge-primary">Exam</span>
      </div>`).join('');

    html += `</div>`;
  }

  // Tasks
  if (tasks.length) {
    html += `
      <h4 class="section-title ${exams.length ? 'mt-4' : ''}">Tasks (${tasks.length})</h4>
      <div class="list" id="dayModalTaskList">`;

    html += tasks.map(t => {
      const subj = Store.getSubject(t.subjectId);
      return `
        <label class="list-item ${t.completed ? 'done' : ''}" style="cursor:pointer">
          <input type="checkbox" class="check" data-modal-toggle="${t.id}" ${t.completed ? 'checked' : ''} aria-label="Mark task complete" />
          <div class="list-item__main">
            <div class="list-item__title">${App.escapeHtml(t.title)}</div>
            <div class="list-item__meta">
              ${subj ? `<span><span class="dot" style="background:${subj.color}"></span>${App.escapeHtml(subj.name)}</span>` : '<span>No subject</span>'}
              <span class="priority-${t.priority}">● ${t.priority}</span>
              ${t.category && t.category !== 'General' ? `<span class="badge badge-category">${App.escapeHtml(t.category)}</span>` : ''}
              ${t.estimate ? `<span class="badge badge-estimate">⏱️ ${Dates.formatDuration(t.estimate)}</span>` : ''}
              ${t.completed ? '<span class="text-success font-bold">✓ Done</span>' : ''}
            </div>
          </div>
        </label>`;
    }).join('');

    html += `</div>`;
  }

  html += `
    <div class="flex-between wrap gap-2 mt-6">
      <a href="tasks.html" class="btn btn-ghost">View All Tasks</a>
      <a href="tasks.html" class="btn btn-primary">+ Add Task</a>
    </div>`;

  App.qs('#dayModalBody').innerHTML = html;

  // Wire interactive checkboxes inside day modal
  App.qsa('[data-modal-toggle]', App.qs('#dayModalBody')).forEach(cb => {
    cb.addEventListener('change', () => {
      const isDone = Store.toggleTask(cb.dataset.modalToggle);
      if (isDone) App.playChime('finish');
      render();
      openDay(iso); // Refresh modal view
    });
  });

  App.openModal('#dayModal');
}