/* ==========================================================================
   calendar.js — Calendar page logic
   Builds a monthly grid; plots tasks (subject color) and exams (red) on their
   dates; supports month navigation and a per-day detail modal.
   ========================================================================== */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

// Current view — start on the month containing today.
const cal = { year: 0, month: 0 };

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

  // Leading blanks so the 1st lands under the right weekday.
  for (let i = 0; i < firstWeekday; i++) cells += `<div class="cal-cell empty"></div>`;

  // One cell per day.
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${cal.year}-${String(cal.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const { tasks, exams } = eventsForDate(iso);
    const isToday = iso === today;

    // Build up to 3 event chips, then a "+N more".
    const chips = [];
    exams.forEach(s => chips.push(`<div class="cal-event exam" title="Exam: ${App.escapeHtml(s.name)}">📚 ${App.escapeHtml(s.name)}</div>`));
    tasks.forEach(t => {
      const subj = Store.getSubject(t.subjectId);
      const color = subj ? subj.color : 'var(--primary)';
      chips.push(`<div class="cal-event" style="background:${color}" title="${App.escapeHtml(t.title)}">${App.escapeHtml(t.title)}</div>`);
    });

    let shown = chips.slice(0, 3).join('');
    if (chips.length > 3) shown += `<div class="cal-event more">+${chips.length - 3} more</div>`;

    const clickable = (tasks.length || exams.length) ? 'style="cursor:pointer"' : '';
    cells += `
      <div class="cal-cell ${isToday ? 'today' : ''}" data-date="${iso}" ${clickable}>
        <span class="cal-cell__num">${day}</span>
        ${shown}
      </div>`;
  }

  grid.innerHTML = cells;

  // Clicking a day with events opens the detail modal.
  App.qsa('.cal-cell[data-date]', grid).forEach(cell => {
    cell.addEventListener('click', () => openDay(cell.dataset.date));
  });
}

/* ==========================================================================
   Day detail modal
   ========================================================================== */
function openDay(iso) {
  const { tasks, exams } = eventsForDate(iso);
  if (!tasks.length && !exams.length) return;   // nothing to show

  App.qs('#dayModalTitle').textContent = Dates.formatLong(iso);

  let html = '';
  if (exams.length) {
    html += `<h4 class="section-title" style="color:var(--danger)">Exams</h4><div class="list">`;
    html += exams.map(s => `
      <div class="list-item">
        <span class="dot" style="background:${s.color};width:14px;height:14px"></span>
        <div class="list-item__main"><div class="list-item__title">${App.escapeHtml(s.name)}</div>
        <div class="list-item__meta">${s.teacher ? App.escapeHtml(s.teacher) : 'Exam day'}</div></div>
      </div>`).join('');
    html += `</div>`;
  }
  if (tasks.length) {
    html += `<h4 class="section-title mt-4">Tasks (${tasks.length})</h4><div class="list">`;
    html += tasks.map(t => {
      const subj = Store.getSubject(t.subjectId);
      return `
        <div class="list-item ${t.completed ? 'done' : ''}">
          <span class="dot" style="background:${subj ? subj.color : 'var(--primary)'}"></span>
          <div class="list-item__main">
            <div class="list-item__title">${App.escapeHtml(t.title)}</div>
            <div class="list-item__meta">
              ${subj ? App.escapeHtml(subj.name) : 'No subject'} ·
              <span class="priority-${t.priority}">${t.priority}</span>
              ${t.completed ? '· ✓ done' : ''}
            </div>
          </div>
        </div>`;
    }).join('');
    html += `</div>`;
  }

  html += `<a href="tasks.html" class="btn btn-primary btn-block mt-6">Manage tasks</a>`;
  App.qs('#dayModalBody').innerHTML = html;
  App.openModal('#dayModal');
}
