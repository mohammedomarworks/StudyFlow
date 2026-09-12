/* ==========================================================================
   calendar.js — Upgraded Academic Calendar Logic
   Features:
   - Monthly calendar navigation with full previous & next month dates
   - Clean visual distinction: Today, Selected Date, Other-Month Dates
   - Compact day indicators: Task count, priority, category, exams, overdue & workload
   - Daily workload calculation: Active tasks, completed tasks, estimated duration
   - Transparent workload levels: Light (<90m), Moderate (90-180m), Heavy (>180m)
   - Week Planning Summary: Active tasks, completed tasks, estimated workload, busiest day
   - Upcoming Deadlines & Exams: Nearest exam and nearest due task countdown
   - Interactive Day Detail Modal: Complete, Edit, Delete, Start Focus, Add Task
   - Quick date navigation: Prev, Today, Next, and native Jump to Date
   - URL parameter deep link support (?date=YYYY-MM-DD)
   - Full keyboard accessibility: Arrow keys, Enter, Space, Tab (roving tabindex)
   - Zero stored state mutation (pure view over Store & Dates)
   ========================================================================== */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

// Current calendar view state
const cal = {
  year: 0,
  month: 0,
  selectedDate: null,
  activeDayISO: null
};

document.addEventListener('DOMContentLoaded', () => {
  const now = new Date();
  cal.year = now.getFullYear();
  cal.month = now.getMonth();
  cal.selectedDate = Dates.todayISO();

  bindControls();
  readUrlParams();
  render();
});

/* ==========================================================================
   URL Deep Link Parsing
   ========================================================================== */
function readUrlParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('date')) {
    const iso = params.get('date');
    const parsed = Dates.parse(iso);
    if (parsed) {
      cal.year = parsed.getFullYear();
      cal.month = parsed.getMonth();
      cal.selectedDate = iso;
      setTimeout(() => openDay(iso), 150);
    }
  }
}

/* ==========================================================================
   Controls Binding
   ========================================================================== */
function bindControls() {
  const prevBtn = App.qs('#calPrev');
  const nextBtn = App.qs('#calNext');
  const todayBtn = App.qs('#calToday');
  const jumpInput = App.qs('#calJumpDate');

  if (prevBtn) prevBtn.addEventListener('click', () => shiftMonth(-1));
  if (nextBtn) nextBtn.addEventListener('click', () => shiftMonth(1));
  if (todayBtn) {
    todayBtn.addEventListener('click', () => {
      const now = new Date();
      cal.year = now.getFullYear();
      cal.month = now.getMonth();
      cal.selectedDate = Dates.todayISO();
      render();
    });
  }

  if (jumpInput) {
    jumpInput.addEventListener('change', e => {
      const val = e.target.value;
      if (!val) return;
      const d = Dates.parse(val);
      if (d) {
        cal.year = d.getFullYear();
        cal.month = d.getMonth();
        cal.selectedDate = val;
        render();
        openDay(val);
      }
    });
  }

  App.bindModalClose('#dayModal');
}

function shiftMonth(delta) {
  cal.month += delta;
  if (cal.month < 0) {
    cal.month = 11;
    cal.year--;
  } else if (cal.month > 11) {
    cal.month = 0;
    cal.year++;
  }
  render();
}

/* ==========================================================================
   Data Snapshot & Lookups (Single pass per render)
   ========================================================================== */
function getCalendarSnapshot() {
  const allTasks = Store.getTasks();
  const allSubjects = Store.getSubjects();

  const tasksByDate = new Map();
  allTasks.forEach(t => {
    if (!t.dueDate) return;
    if (!tasksByDate.has(t.dueDate)) tasksByDate.set(t.dueDate, []);
    tasksByDate.get(t.dueDate).push(t);
  });

  const examsByDate = new Map();
  allSubjects.forEach(s => {
    if (!s.examDate) return;
    if (!examsByDate.has(s.examDate)) examsByDate.set(s.examDate, []);
    examsByDate.get(s.examDate).push(s);
  });

  const subjectMap = new Map();
  allSubjects.forEach(s => subjectMap.set(s.id, s));

  return { allTasks, allSubjects, tasksByDate, examsByDate, subjectMap };
}

/* ==========================================================================
   Workload Calculations
   Rule:
   - Light: Under 90 min active workload
   - Moderate: 90 - 180 min active workload
   - Heavy: Over 180 min active workload
   ========================================================================== */
function calculateDayWorkload(tasks) {
  const activeTasks = tasks.filter(t => !t.completed);
  const completedTasks = tasks.filter(t => t.completed);
  const activeMinutes = activeTasks.reduce((sum, t) => sum + (Number(t.estimate) || 0), 0);

  let level = 'none';
  if (activeTasks.length > 0 || activeMinutes > 0) {
    if (activeMinutes > 180) {
      level = 'heavy';
    } else if (activeMinutes >= 90) {
      level = 'moderate';
    } else {
      level = 'light';
    }
  }

  return {
    activeCount: activeTasks.length,
    completedCount: completedTasks.length,
    totalCount: tasks.length,
    activeMinutes,
    durationText: Dates.formatDuration(activeMinutes),
    level
  };
}

/* ==========================================================================
   Main Render Pipeline
   ========================================================================== */
function render() {
  const snapshot = getCalendarSnapshot();

  // Update header label and jump input
  const monthLabel = App.qs('#calMonthLabel');
  if (monthLabel) monthLabel.textContent = `${MONTHS[cal.month]} ${cal.year}`;

  const jumpInput = App.qs('#calJumpDate');
  if (jumpInput) {
    jumpInput.value = cal.selectedDate || Dates.todayISO();
  }

  // Render summaries
  renderWeekSummary(snapshot);
  renderUpcomingDeadlines(snapshot);

  // Render month grid
  renderGrid(snapshot);
}

/* ==========================================================================
   Week Planning Summary (Current Week)
   ========================================================================== */
function renderWeekSummary(snapshot) {
  const container = App.qs('#calWeekSummary');
  if (!container) return;

  // Compute current week days (Sunday to Saturday) containing today
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=Sun
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - dayOfWeek);

  const weekDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    weekDays.push(Dates.toISO(d));
  }

  let activeCount = 0;
  let completedCount = 0;
  let totalEstimatedMinutes = 0;
  const dayWorkloads = [];

  weekDays.forEach(iso => {
    const tasks = snapshot.tasksByDate.get(iso) || [];
    const workload = calculateDayWorkload(tasks);
    activeCount += workload.activeCount;
    completedCount += workload.completedCount;
    totalEstimatedMinutes += workload.activeMinutes;

    if (workload.activeCount > 0) {
      dayWorkloads.push({
        iso,
        activeCount: workload.activeCount,
        minutes: workload.activeMinutes
      });
    }
  });

  // Calculate busiest day (highest active minutes, tie-breaker active count)
  let busiestText = 'None · All caught up! 🎉';
  if (dayWorkloads.length > 0) {
    dayWorkloads.sort((a, b) => {
      if (b.minutes !== a.minutes) return b.minutes - a.minutes;
      return b.activeCount - a.activeCount;
    });
    const busiest = dayWorkloads[0];
    const parsedDate = Dates.parse(busiest.iso);
    const dayName = parsedDate ? parsedDate.toLocaleDateString('en-US', { weekday: 'long' }) : 'Day';
    const dur = busiest.minutes > 0 ? Dates.formatDuration(busiest.minutes) : `${busiest.activeCount} tasks`;
    busiestText = `${dayName} · ${dur}`;
  }

  container.innerHTML = `
    <div class="cal-summary-card__header">
      <div class="cal-summary-card__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
        </svg>
      </div>
      <div>
        <h3 class="cal-summary-card__title">This Week's Plan</h3>
        <p class="cal-summary-card__desc">${Dates.formatShort(weekDays[0])} – ${Dates.formatShort(weekDays[6])}</p>
      </div>
    </div>
    <div class="cal-summary-metrics">
      <div class="cal-metric">
        <span class="cal-metric__label">Active Tasks</span>
        <span class="cal-metric__val font-bold">${activeCount}</span>
        <span class="cal-metric__sub text-muted">${Dates.formatDuration(totalEstimatedMinutes)} estimated</span>
      </div>
      <div class="cal-metric">
        <span class="cal-metric__label">Completed</span>
        <span class="cal-metric__val font-bold text-success">${completedCount}</span>
        <span class="cal-metric__sub text-muted">done</span>
      </div>
      <div class="cal-metric cal-metric--wide">
        <span class="cal-metric__label">Busiest Day</span>
        <span class="cal-metric__busiest font-semibold">${App.escapeHtml(busiestText)}</span>
      </div>
    </div>
  `;
}

/* ==========================================================================
   Upcoming Deadlines & Exams (Compact Nearest Items)
   ========================================================================== */
function renderUpcomingDeadlines(snapshot) {
  const container = App.qs('#calUpcoming');
  if (!container) return;

  const today = Dates.todayISO();

  // Nearest upcoming exam (>= today)
  const upcomingExams = snapshot.allSubjects
    .filter(s => s.examDate && s.examDate >= today)
    .sort((a, b) => a.examDate.localeCompare(b.examDate));
  const nearestExam = upcomingExams[0] || null;

  // Nearest upcoming active task (>= today)
  const upcomingTasks = snapshot.allTasks
    .filter(t => !t.completed && t.dueDate && t.dueDate >= today)
    .sort((a, b) => {
      const d = a.dueDate.localeCompare(b.dueDate);
      if (d !== 0) return d;
      const rank = { high: 0, medium: 1, low: 2 };
      return (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1);
    });
  const nearestTask = upcomingTasks[0] || null;

  // Overdue tasks count
  const overdueCount = snapshot.allTasks.filter(t => !t.completed && t.dueDate && t.dueDate < today).length;

  let examHtml = '';
  if (nearestExam) {
    const days = Dates.daysFromToday(nearestExam.examDate);
    let relText = `in ${days} days`;
    if (days === 0) relText = 'Today!';
    else if (days === 1) relText = 'Tomorrow';

    examHtml = `
      <div class="cal-upcoming-item">
        <span class="cal-upcoming-dot" style="background:${nearestExam.color}"></span>
        <div class="cal-upcoming-info">
          <div class="cal-upcoming-title flex items-center gap-2">
            <span>${App.escapeHtml(nearestExam.name)} Exam</span>
            <span class="badge badge-primary badge-xs">Exam</span>
          </div>
          <div class="cal-upcoming-due text-danger font-semibold">📚 ${relText} (${Dates.formatShort(nearestExam.examDate)})</div>
        </div>
      </div>
    `;
  } else {
    examHtml = `
      <div class="cal-upcoming-item text-muted" style="font-size:var(--fs-xs)">
        <span>No upcoming exams scheduled</span>
      </div>
    `;
  }

  let taskHtml = '';
  if (nearestTask) {
    const subj = snapshot.subjectMap.get(nearestTask.subjectId);
    const days = Dates.daysFromToday(nearestTask.dueDate);
    let relText = `in ${days} days`;
    let relClass = 'text-muted';
    if (days === 0) { relText = 'Due today!'; relClass = 'text-warning font-semibold'; }
    else if (days === 1) { relText = 'Due tomorrow'; relClass = 'text-warning'; }

    taskHtml = `
      <div class="cal-upcoming-item">
        <span class="cal-upcoming-dot" style="background:${subj ? subj.color : 'var(--primary)'}"></span>
        <div class="cal-upcoming-info">
          <div class="cal-upcoming-title">${App.escapeHtml(nearestTask.title)}</div>
          <div class="cal-upcoming-due ${relClass}">
            ⏳ ${relText} · <span class="priority-${nearestTask.priority}">● ${nearestTask.priority}</span>
          </div>
        </div>
      </div>
    `;
  } else {
    taskHtml = `
      <div class="cal-upcoming-item text-muted" style="font-size:var(--fs-xs)">
        <span>No pending upcoming tasks</span>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="cal-summary-card__header flex-between">
      <div class="flex items-center gap-2">
        <div class="cal-summary-card__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>
        <div>
          <h3 class="cal-summary-card__title">Upcoming Deadlines</h3>
          <p class="cal-summary-card__desc">Nearest academic milestones</p>
        </div>
      </div>
      ${overdueCount > 0 ? `<span class="badge badge-overdue font-semibold" title="${overdueCount} overdue task(s)">⚠️ ${overdueCount} overdue</span>` : ''}
    </div>
    <div class="cal-upcoming-list">
      ${examHtml}
      ${taskHtml}
    </div>
  `;
}

/* ==========================================================================
   Month Grid Rendering (Full weeks with previous & next month dates)
   ========================================================================== */
function renderGrid(snapshot) {
  const grid = App.qs('#calGrid');
  if (!grid) return;

  const today = Dates.todayISO();

  const firstWeekday = new Date(cal.year, cal.month, 1).getDay(); // 0 = Sunday
  const daysInMonth = new Date(cal.year, cal.month + 1, 0).getDate();
  const daysInPrevMonth = new Date(cal.year, cal.month, 0).getDate();

  // Determine total cells needed (always multiples of 7: 35 or 42)
  const totalSlotsNeeded = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const trailingDaysCount = totalSlotsNeeded - (firstWeekday + daysInMonth);

  const cellDataList = [];

  // 1. Previous Month Leading Days
  for (let i = firstWeekday - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    const prevDate = new Date(cal.year, cal.month - 1, day);
    const iso = Dates.toISO(prevDate);
    cellDataList.push({
      iso,
      day,
      isOtherMonth: true,
      monthOffset: -1
    });
  }

  // 2. Current Month Days
  for (let day = 1; day <= daysInMonth; day++) {
    const curDate = new Date(cal.year, cal.month, day);
    const iso = Dates.toISO(curDate);
    cellDataList.push({
      iso,
      day,
      isOtherMonth: false,
      monthOffset: 0
    });
  }

  // 3. Next Month Trailing Days
  for (let day = 1; day <= trailingDaysCount; day++) {
    const nextDate = new Date(cal.year, cal.month + 1, day);
    const iso = Dates.toISO(nextDate);
    cellDataList.push({
      iso,
      day,
      isOtherMonth: true,
      monthOffset: 1
    });
  }

  // Find index of cell to receive tabindex="0" (roving tabindex)
  let activeFocusIdx = cellDataList.findIndex(c => c.iso === cal.selectedDate);
  if (activeFocusIdx === -1) {
    activeFocusIdx = cellDataList.findIndex(c => c.iso === today);
  }
  if (activeFocusIdx === -1) {
    activeFocusIdx = cellDataList.findIndex(c => !c.isOtherMonth && c.day === 1);
  }
  if (activeFocusIdx === -1) activeFocusIdx = 0;

  // Build cell HTML
  let html = '';
  cellDataList.forEach((cell, idx) => {
    const iso = cell.iso;
    const tasks = snapshot.tasksByDate.get(iso) || [];
    const exams = snapshot.examsByDate.get(iso) || [];
    const workload = calculateDayWorkload(tasks);

    const isToday = iso === today;
    const isSelected = iso === cal.selectedDate;
    const isPast = Dates.daysFromToday(iso) < 0;
    const hasOverdue = isPast && workload.activeCount > 0;
    const hasHighPriority = tasks.some(t => !t.completed && t.priority === 'high');
    const allDone = tasks.length > 0 && workload.activeCount === 0;

    let cellClasses = ['cal-cell'];
    if (cell.isOtherMonth) cellClasses.push('cal-cell--other-month');
    if (isToday) cellClasses.push('cal-cell--today');
    if (isSelected) cellClasses.push('cal-cell--selected');
    if (workload.level === 'heavy') cellClasses.push('cal-cell--heavy');
    if (hasOverdue) cellClasses.push('cal-cell--has-overdue');

    // Build compact indicators
    let indicatorsHtml = '';

    // 1. Exam badges
    if (exams.length > 0) {
      exams.forEach(s => {
        indicatorsHtml += `
          <div class="cal-chip cal-chip--exam" title="Exam: ${App.escapeHtml(s.name)}">
            <span class="cal-chip__icon">📚</span>
            <span class="cal-chip__text">${App.escapeHtml(s.name)}</span>
          </div>
        `;
      });
    }

    // 2. Compact Task Summary Pill
    if (tasks.length > 0) {
      // Collect unique subject dots
      const uniqueSubjIds = Array.from(new Set(tasks.map(t => t.subjectId).filter(Boolean)));
      const dotsHtml = uniqueSubjIds.slice(0, 3).map(id => {
        const subj = snapshot.subjectMap.get(id);
        const color = subj ? subj.color : 'var(--primary)';
        return `<span class="cal-dot" style="background:${color}"></span>`;
      }).join('');

      indicatorsHtml += `
        <div class="cal-task-summary ${allDone ? 'cal-task-summary--done' : ''}">
          <span class="cal-dots-group">${dotsHtml}</span>
          <span class="cal-task-count font-semibold">${tasks.length} task${tasks.length === 1 ? '' : 's'}</span>
        </div>
      `;
    }

    // 3. Urgency / Status badges (High priority, overdue, heavy workload, or all done)
    const tagBadges = [];
    if (hasOverdue) {
      tagBadges.push(`<span class="cal-tag cal-tag--overdue" title="Overdue tasks present">⚠️ Overdue</span>`);
    } else if (hasHighPriority) {
      tagBadges.push(`<span class="cal-tag cal-tag--high" title="High priority task due">🔥 High</span>`);
    }

    if (workload.level === 'heavy') {
      tagBadges.push(`<span class="cal-tag cal-tag--heavy" title="Heavy workload (${workload.durationText})">⚡ Heavy</span>`);
    } else if (allDone && exams.length === 0) {
      tagBadges.push(`<span class="cal-tag cal-tag--done" title="All tasks completed">✓ Done</span>`);
    }

    if (tagBadges.length > 0) {
      indicatorsHtml += `<div class="cal-tags-row">${tagBadges.join('')}</div>`;
    }

    // Accessible ARIA description
    const count = tasks.length + exams.length;
    let ariaLabel = `${Dates.formatLong(iso)}`;
    if (isToday) ariaLabel += ', Today';
    if (isSelected) ariaLabel += ', Selected date';
    if (count === 0) {
      ariaLabel += ', No items scheduled';
    } else {
      ariaLabel += `, ${tasks.length} task${tasks.length === 1 ? '' : 's'}`;
      if (exams.length > 0) ariaLabel += `, ${exams.length} exam${exams.length === 1 ? '' : 's'}`;
      if (workload.activeMinutes > 0) ariaLabel += `, ${workload.durationText} active workload`;
      if (workload.level === 'heavy') ariaLabel += ', Heavy workload day';
      if (hasOverdue) ariaLabel += ', Overdue tasks';
      if (allDone) ariaLabel += ', All tasks completed';
    }

    const tabIndex = idx === activeFocusIdx ? '0' : '-1';

    html += `
      <div class="${cellClasses.join(' ')}"
           data-date="${iso}"
           data-offset="${cell.monthOffset}"
           role="gridcell"
           tabindex="${tabIndex}"
           aria-label="${App.escapeHtml(ariaLabel)}"
           title="${Dates.formatShort(iso)}: ${count ? `${count} item${count === 1 ? '' : 's'}` : 'Nothing scheduled'}">
        <div class="cal-cell__head">
          <span class="cal-cell__overload-indicator" aria-hidden="true">${workload.level === 'heavy' ? '⚡' : ''}</span>
          <span class="cal-cell__num">${cell.day}</span>
        </div>
        <div class="cal-cell__content">
          ${indicatorsHtml}
        </div>
      </div>
    `;
  });

  grid.innerHTML = html;
  wireGridEvents(grid);
}

/* ==========================================================================
   Wire Grid Events (Click & Keyboard Roving Tabindex)
   ========================================================================== */
function wireGridEvents(grid) {
  const allCells = App.qsa('.cal-cell[data-date]', grid);

  allCells.forEach((cell, idx) => {
    const iso = cell.dataset.date;
    const offset = Number(cell.dataset.offset) || 0;

    // Click handler
    cell.addEventListener('click', () => {
      handleCellSelect(idx, iso, offset);
    });

    // Keyboard navigation
    cell.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleCellSelect(idx, iso, offset);
      } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        let targetIdx = idx;
        if (e.key === 'ArrowLeft' && idx > 0) targetIdx = idx - 1;
        else if (e.key === 'ArrowRight' && idx < allCells.length - 1) targetIdx = idx + 1;
        else if (e.key === 'ArrowUp' && idx >= 7) targetIdx = idx - 7;
        else if (e.key === 'ArrowDown' && idx + 7 < allCells.length) targetIdx = idx + 7;

        if (targetIdx !== idx) {
          e.preventDefault();
          updateRovingFocus(allCells, targetIdx);
        }
      }
    });
  });
}

function updateRovingFocus(allCells, targetIdx) {
  allCells.forEach((c, i) => {
    c.setAttribute('tabindex', i === targetIdx ? '0' : '-1');
  });
  const targetCell = allCells[targetIdx];
  if (targetCell) {
    targetCell.focus();
    cal.selectedDate = targetCell.dataset.date;
    // Visually update selected class
    allCells.forEach(c => c.classList.remove('cal-cell--selected'));
    targetCell.classList.add('cal-cell--selected');
  }
}

function handleCellSelect(idx, iso, offset) {
  cal.selectedDate = iso;

  // If clicked a cell from previous or next month, shift view to that month
  if (offset !== 0) {
    shiftMonth(offset);
    setTimeout(() => openDay(iso), 100);
    return;
  }

  // Update selected class in DOM
  const grid = App.qs('#calGrid');
  if (grid) {
    App.qsa('.cal-cell', grid).forEach(c => c.classList.remove('cal-cell--selected'));
    const current = grid.querySelector(`[data-date="${iso}"]`);
    if (current) current.classList.add('cal-cell--selected');
  }

  openDay(iso);
}

/* ==========================================================================
   Interactive Day Detail Modal
   ========================================================================== */
function openDay(iso) {
  cal.activeDayISO = iso;
  const snapshot = getCalendarSnapshot();
  const tasks = snapshot.tasksByDate.get(iso) || [];
  const exams = snapshot.examsByDate.get(iso) || [];
  const workload = calculateDayWorkload(tasks);

  const titleEl = App.qs('#dayModalTitle');
  const subtitleEl = App.qs('#dayModalSubtitle');
  if (titleEl) titleEl.textContent = Dates.formatLong(iso);
  if (subtitleEl) {
    const rel = Dates.relative(iso);
    subtitleEl.textContent = rel ? `${rel} · Academic schedule` : 'Academic schedule';
  }

  let html = '';

  // 1. Workload Banner
  if (tasks.length > 0) {
    let bannerClass = 'cal-workload-banner--light';
    let bannerTag = 'Light Workload';
    let bannerDesc = `${workload.activeCount} active task${workload.activeCount === 1 ? '' : 's'} · ${workload.durationText} workload`;

    if (workload.level === 'heavy') {
      bannerClass = 'cal-workload-banner--heavy';
      bannerTag = '⚡ Heavy Workload (>3h)';
      bannerDesc = `${workload.activeCount} active tasks · ${workload.durationText} estimated active study`;
    } else if (workload.level === 'moderate') {
      bannerClass = 'cal-workload-banner--moderate';
      bannerTag = 'Moderate Workload';
      bannerDesc = `${workload.activeCount} active tasks · ${workload.durationText} estimated active study`;
    } else if (workload.activeCount === 0) {
      bannerClass = 'cal-workload-banner--done';
      bannerTag = '✓ All Caught Up';
      bannerDesc = `All ${workload.completedCount} task${workload.completedCount === 1 ? '' : 's'} completed for this day!`;
    }

    html += `
      <div class="cal-workload-banner ${bannerClass}">
        <div class="cal-workload-banner__main">
          <span class="cal-workload-banner__tag">${bannerTag}</span>
          <span class="cal-workload-banner__desc">${bannerDesc}</span>
        </div>
        <div class="cal-workload-banner__counts">
          <span><b>${workload.activeCount}</b> active</span>
          <span>·</span>
          <span><b>${workload.completedCount}</b> done</span>
        </div>
      </div>
    `;
  }

  // 2. Empty State (if no tasks and no exams)
  if (!tasks.length && !exams.length) {
    html = `
      <div class="empty" style="padding:var(--space-6) 0">
        <div class="empty__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/>
          </svg>
        </div>
        <h3>Nothing scheduled</h3>
        <p>You have no tasks or exams scheduled for ${Dates.formatShort(iso)}.</p>
        <a href="tasks.html?action=new&date=${iso}" class="btn btn-primary mt-4">+ Add Task for this Day</a>
      </div>
    `;
    App.qs('#dayModalBody').innerHTML = html;
    App.openModal('#dayModal');
    return;
  }

  // 3. Exams Section
  if (exams.length > 0) {
    html += `
      <div class="cal-modal-section">
        <h4 class="section-title text-danger flex items-center gap-2">
          <span>📚 Exams (${exams.length})</span>
        </h4>
        <div class="list">
          ${exams.map(s => `
            <div class="list-item">
              <span class="dot" style="background:${s.color};width:14px;height:14px"></span>
              <div class="list-item__main">
                <div class="list-item__title font-bold">${App.escapeHtml(s.name)}</div>
                <div class="list-item__meta">
                  <span>${s.teacher ? App.escapeHtml(s.teacher) : 'Exam Day'}</span>
                  ${s.examDate ? `<span class="badge badge-muted">Date: ${Dates.formatShort(s.examDate)}</span>` : ''}
                </div>
              </div>
              <span class="badge badge-danger">Exam</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // 4. Tasks Section
  if (tasks.length > 0) {
    html += `
      <div class="cal-modal-section ${exams.length ? 'mt-5' : ''}">
        <h4 class="section-title flex-between">
          <span>Tasks (${tasks.length})</span>
          <span class="text-muted" style="font-size:var(--fs-xs)">${workload.durationText} total workload</span>
        </h4>
        <div class="list cal-modal-tasks">
          ${tasks.map(t => {
            const subj = snapshot.subjectMap.get(t.subjectId);
            const isOverdue = !t.completed && Dates.daysFromToday(t.dueDate) < 0;

            return `
              <div class="list-item cal-modal-task-item ${t.completed ? 'done' : ''} ${isOverdue ? 'is-overdue' : ''}" data-task-row="${t.id}">
                <input type="checkbox"
                       class="check"
                       data-modal-toggle="${t.id}"
                       ${t.completed ? 'checked' : ''}
                       aria-label="Mark task ${App.escapeHtml(t.title)} complete" />

                <div class="list-item__main">
                  <div class="list-item__title ${t.completed ? 'line-through text-muted' : ''}">
                    ${App.escapeHtml(t.title)}
                  </div>
                  <div class="list-item__meta flex wrap gap-2 items-center">
                    ${subj ? `<span class="badge badge-muted"><span class="dot" style="background:${subj.color}"></span>${App.escapeHtml(subj.name)}</span>` : '<span class="badge badge-muted">No subject</span>'}
                    <span class="badge badge-muted priority-${t.priority}">● ${t.priority}</span>
                    ${t.category && t.category !== 'General' ? `<span class="badge badge-category">${App.escapeHtml(t.category)}</span>` : ''}
                    ${t.estimate ? `<span class="badge badge-estimate">⏱️ ${Dates.formatDuration(t.estimate)}</span>` : ''}
                    ${isOverdue ? '<span class="badge badge-overdue font-semibold">⚠️ Overdue</span>' : ''}
                    ${t.completed ? '<span class="text-success font-semibold">✓ Completed</span>' : ''}
                  </div>
                </div>

                <div class="cal-task-item__actions flex items-center gap-1">
                  ${t.completed ? '' : `
                    <a href="timer.html?taskId=${t.id}${t.subjectId ? `&subjectId=${t.subjectId}` : ''}&autostart=1"
                       class="icon-btn"
                       title="Start a focus session for this task"
                       aria-label="Start focus session on ${App.escapeHtml(t.title)}">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    </a>
                  `}
                  <a href="tasks.html?edit=${t.id}"
                     class="icon-btn"
                     title="Edit Task"
                     aria-label="Edit task ${App.escapeHtml(t.title)}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                  </a>
                  <button type="button"
                          class="icon-btn danger"
                          data-delete-task="${t.id}"
                          title="Delete Task"
                          aria-label="Delete task ${App.escapeHtml(t.title)}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // 5. Modal Footer Actions
  html += `
    <div class="flex-between wrap gap-2 mt-6 pt-4 border-top">
      <a href="tasks.html" class="btn btn-ghost btn-sm">View All Tasks</a>
      <a href="tasks.html?action=new&date=${iso}" class="btn btn-primary btn-sm">+ Add Task for this Day</a>
    </div>
  `;

  App.qs('#dayModalBody').innerHTML = html;

  // Wire interactive checkboxes inside day modal
  App.qsa('[data-modal-toggle]', App.qs('#dayModalBody')).forEach(cb => {
    cb.addEventListener('change', () => {
      const isDone = Store.toggleTask(cb.dataset.modalToggle);
      if (isDone) App.playChime('finish');
      App.toast(isDone ? 'Task completed! 🎉' : 'Marked as active', isDone ? 'success' : 'info');
      render();
      openDay(iso); // Refresh modal view
    });
  });

  // Wire delete task buttons inside day modal
  App.qsa('[data-delete-task]', App.qs('#dayModalBody')).forEach(btn => {
    btn.addEventListener('click', () => {
      const taskId = btn.dataset.deleteTask;
      const t = Store.getTask(taskId);
      if (!t) return;
      App.confirm({
        title: 'Delete task?',
        message: `"${t.title}" will be permanently removed.`,
        confirmText: 'Delete',
        onConfirm: () => {
          Store.deleteTask(taskId);
          App.toast('Task deleted', 'info');
          render();
          openDay(iso);
        }
      });
    });
  });

  App.openModal('#dayModal');
}