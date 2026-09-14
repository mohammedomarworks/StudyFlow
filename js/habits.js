/* ==========================================================================
   habits.js — Academic Habit Tracker Logic (Phase 9 / v1.5.0)
   Features:
   - Daily & weekday habit management with persistent LocalStorage data
   - Dynamic streak calculation (current streak & best streak, never stored)
   - Real-time today's habit check-off with undo and chime feedback
   - 7-Day current week consistency strip (Mon-Sun)
   - 30-Day consistency history overview
   - Subject association with subject color badges
   - Archive & restore workflow to preserve historical records
   - Search, frequency, and subject filtering
   - Accessible ARIA labels, semantic markup, and keyboard support
   ========================================================================== */

const HABIT_COLORS = ['#7c3aed', '#2563eb', '#0d9488', '#db2777', '#ea580c', '#16a34a', '#dc2626', '#0891b2'];
const HABIT_EMOJIS = ['📝', '💻', '📖', '🔬', '🎯', '💡', '⚡', '🧠', '🏃', '📚', '✍️', '🌙'];

const habitsView = {
  search: '',
  frequency: 'all', // 'all' | 'daily' | 'weekdays'
  subject: 'all',
  tab: 'active',    // 'active' | 'archived'
  selectedColor: HABIT_COLORS[0],
  selectedIcon: HABIT_EMOJIS[0]
};

document.addEventListener('DOMContentLoaded', () => {
  readUrlParams();
  populateDropdowns();
  initIconAndColorPickers();
  bindToolbar();
  bindTabs();
  bindModal();
  renderAllHabitsData();
});

/* ==========================================================================
   URL Parameter Handling
   ========================================================================== */
function readUrlParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('tab')) {
    const t = params.get('tab').toLowerCase();
    if (['active', 'archived'].includes(t)) habitsView.tab = t;
  }
  if (params.has('search')) {
    habitsView.search = params.get('search').toLowerCase();
    const input = App.qs('#habitSearchInput');
    if (input) input.value = params.get('search');
  }
  if (params.has('frequency')) {
    const f = params.get('frequency').toLowerCase();
    if (['all', 'daily', 'weekdays'].includes(f)) habitsView.frequency = f;
  }
  if (params.has('subject')) {
    habitsView.subject = params.get('subject');
  }
  if (params.get('action') === 'new') {
    setTimeout(() => openHabitModal(), 100);
  }
}

/* ==========================================================================
   Dropdowns & Setup
   ========================================================================== */
function populateDropdowns() {
  const subjects = Store.getSubjects();
  const filterSubj = App.qs('#filterSubject');
  const habitSubj = App.qs('#habitSubject');

  if (filterSubj) {
    let opts = '<option value="all">All Subjects</option>';
    subjects.forEach(s => {
      opts += `<option value="${s.id}">${App.escapeHtml(s.name)}</option>`;
    });
    filterSubj.innerHTML = opts;
    filterSubj.value = habitsView.subject;
  }

  if (habitSubj) {
    let opts = '<option value="">— General (No subject) —</option>';
    subjects.forEach(s => {
      opts += `<option value="${s.id}">${App.escapeHtml(s.name)}</option>`;
    });
    habitSubj.innerHTML = opts;
  }
}

function initIconAndColorPickers() {
  // Emoji presets
  const presetsContainer = App.qs('#emojiPresets');
  if (presetsContainer) {
    presetsContainer.innerHTML = HABIT_EMOJIS.map(em => `
      <button type="button" class="emoji-preset-btn ${em === habitsView.selectedIcon ? 'selected' : ''}" data-emoji="${em}">
        ${em}
      </button>
    `).join('');

    App.qsa('.emoji-preset-btn', presetsContainer).forEach(btn => {
      btn.addEventListener('click', () => {
        habitsView.selectedIcon = btn.dataset.emoji;
        App.qsa('.emoji-preset-btn', presetsContainer).forEach(b => b.classList.toggle('selected', b === btn));
        const customInput = App.qs('#habitCustomIcon');
        if (customInput) customInput.value = habitsView.selectedIcon;
      });
    });

    const customInput = App.qs('#habitCustomIcon');
    if (customInput) {
      customInput.value = habitsView.selectedIcon;
      customInput.addEventListener('input', e => {
        const val = e.target.value.trim();
        if (val) {
          habitsView.selectedIcon = val;
          App.qsa('.emoji-preset-btn', presetsContainer).forEach(b => b.classList.toggle('selected', b.dataset.emoji === val));
        }
      });
    }
  }

  // Color Swatches
  const swatchesContainer = App.qs('#habitColorSwatches');
  if (swatchesContainer) {
    swatchesContainer.innerHTML = HABIT_COLORS.map(c => `
      <button type="button" class="swatch ${c === habitsView.selectedColor ? 'selected' : ''}" data-color="${c}" style="background:${c}" aria-label="Color ${c}"></button>
    `).join('');

    App.qsa('.swatch', swatchesContainer).forEach(sw => {
      sw.addEventListener('click', () => {
        habitsView.selectedColor = sw.dataset.color;
        App.qsa('.swatch', swatchesContainer).forEach(s => s.classList.toggle('selected', s === sw));
      });
    });
  }
}

/* ==========================================================================
   Toolbar & Tab Bindings
   ========================================================================== */
function bindToolbar() {
  const searchInput = App.qs('#habitSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', App.debounce(e => {
      habitsView.search = e.target.value.trim().toLowerCase();
      renderHabitsList();
    }, 150));
  }

  const filterFreq = App.qs('#filterFrequency');
  if (filterFreq) {
    filterFreq.value = habitsView.frequency;
    filterFreq.addEventListener('change', e => {
      habitsView.frequency = e.target.value;
      renderHabitsList();
    });
  }

  const filterSubj = App.qs('#filterSubject');
  if (filterSubj) {
    filterSubj.addEventListener('change', e => {
      habitsView.subject = e.target.value;
      renderHabitsList();
    });
  }
}

function bindTabs() {
  const tabsContainer = App.qs('#habitTabs');
  if (!tabsContainer) return;

  App.qsa('.tab-btn', tabsContainer).forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab === habitsView.tab) return;
      habitsView.tab = tab;

      App.qsa('.tab-btn', tabsContainer).forEach(b => {
        const isSelected = b === btn;
        b.classList.toggle('active', isSelected);
        b.setAttribute('aria-selected', isSelected);
      });

      renderHabitsList();
    });
  });
}

/* ==========================================================================
   Master Render Pipeline
   ========================================================================== */
function renderAllHabitsData() {
  renderSummaryMetrics();
  renderHabitsList();
  renderHistoryMatrix();
  highlightFocusedHabit();
}

/* ---- 1. Top Summary Metrics ---------------------------------------------- */
function renderSummaryMetrics() {
  const stats = Store.getHabitStats();
  const allHabits = Store.getHabits(true);
  const activeHabits = allHabits.filter(h => !h.archived);
  const archivedHabits = allHabits.filter(h => h.archived);

  // Update tab counters
  const activeTabCount = App.qs('#activeTabCount');
  const archivedTabCount = App.qs('#archivedTabCount');
  if (activeTabCount) activeTabCount.textContent = activeHabits.length;
  if (archivedTabCount) archivedTabCount.textContent = archivedHabits.length;

  // 1. Today's Progress
  const todayVal = App.qs('#todayProgressVal');
  const todaySub = App.qs('#todayProgressSub');
  const todayBar = App.qs('#todayProgressBar');
  if (todayVal) todayVal.textContent = `${stats.completedToday} / ${stats.totalToday}`;
  if (todaySub) {
    todaySub.textContent = stats.totalToday === 0
      ? 'No habits scheduled for today'
      : `${stats.rateToday}% completed today`;
  }
  if (todayBar) {
    todayBar.style.width = `${stats.rateToday}%`;
  }

  // 2. Top Streak
  const streakVal = App.qs('#topStreakVal');
  const streakSub = App.qs('#topStreakSub');
  if (streakVal) streakVal.textContent = `${stats.bestCurrentStreak} ${stats.bestCurrentStreak === 1 ? 'day' : 'days'}`;
  if (streakSub) {
    if (activeHabits.length === 0) {
      streakSub.textContent = 'No active habits';
    } else {
      // Find habit with top streak
      let topHabit = null;
      let maxS = -1;
      activeHabits.forEach(h => {
        const s = Store.getHabitStreak(h.id).currentStreak;
        if (s > maxS) {
          maxS = s;
          topHabit = h;
        }
      });
      streakSub.textContent = topHabit && maxS > 0
        ? `Leading: ${App.escapeHtml(topHabit.name)}`
        : 'Complete habits today to grow streaks';
    }
  }

  // 3. Weekly Consistency Rate
  const weekVal = App.qs('#weeklyRateVal');
  const weekSub = App.qs('#weeklyRateSub');
  if (weekVal) weekVal.textContent = `${stats.rateWeek}%`;
  if (weekSub) {
    weekSub.textContent = stats.totalWeekScheduled === 0
      ? '0 scheduled this week'
      : `${stats.totalWeekCompleted} of ${stats.totalWeekScheduled} completed this week`;
  }

  // 4. Total Active Habits
  const activeVal = App.qs('#activeHabitsVal');
  const activeSub = App.qs('#activeHabitsSub');
  if (activeVal) activeVal.textContent = activeHabits.length;
  if (activeSub) activeSub.textContent = `${archivedHabits.length} archived`;
}

/* ---- 2. Habit Cards List ------------------------------------------------ */
function renderHabitsList() {
  const container = App.qs('#habitsContainer');
  if (!container) return;

  const isArchivedTab = habitsView.tab === 'archived';
  const allHabits = Store.getHabits(true);

  let habits = allHabits.filter(h => isArchivedTab ? h.archived : !h.archived);

  // Search filter
  if (habitsView.search) {
    habits = habits.filter(h => {
      const subj = Store.getSubject(h.subjectId);
      return h.name.toLowerCase().includes(habitsView.search) ||
             h.description.toLowerCase().includes(habitsView.search) ||
             (subj && subj.name.toLowerCase().includes(habitsView.search));
    });
  }

  // Frequency filter
  if (habitsView.frequency !== 'all') {
    habits = habits.filter(h => h.frequency === habitsView.frequency);
  }

  // Subject filter
  if (habitsView.subject !== 'all') {
    habits = habits.filter(h => h.subjectId === habitsView.subject);
  }

  if (habits.length === 0) {
    if (isArchivedTab) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <div class="empty-state__icon">📦</div>
          <div class="empty-state__title">No Archived Habits</div>
          <div class="empty-state__desc">When you retire an active habit, it will appear here so you can keep or inspect its historical data.</div>
        </div>`;
    } else if (allHabits.filter(h => !h.archived).length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <div class="empty-state__icon">⚡</div>
          <div class="empty-state__title">Build Your Study Habits</div>
          <div class="empty-state__desc">Track daily reading, problem solving, note revision, or exam preparation. Small daily routines lead to huge academic success.</div>
          <button type="button" class="btn btn-primary mt-3" onclick="openHabitModal()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            Create Your First Habit
          </button>
        </div>`;
    } else {
      container.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <div class="empty-state__icon">🔍</div>
          <div class="empty-state__title">No Matching Habits</div>
          <div class="empty-state__desc">No habits matched your active filters. Try changing your search or frequency selection.</div>
          <button type="button" class="btn btn-ghost mt-3" onclick="resetHabitFilters()">Reset Filters</button>
        </div>`;
    }
    return;
  }

  const todayISO = Dates.todayISO();
  const todayDate = Dates.parse(todayISO);
  const weekDays = Dates.getWeekDates(todayISO);

  container.innerHTML = habits.map(h => {
    const subj = Store.getSubject(h.subjectId);
    const { currentStreak, bestStreak } = Store.getHabitStreak(h.id);
    const isTodayDone = Store.isHabitCompletedOnDate(h.id, todayISO);
    const isTodayScheduled = Store.isHabitScheduledOn(h, todayDate);
    const weeklyStatus = Store.getHabitWeeklyStatus(h.id, weekDays);

    let freqLabel = 'Daily';
    if (h.frequency === 'weekdays') {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const targetDays = Array.isArray(h.targetDays) ? h.targetDays : [];
      freqLabel = targetDays.map(d => dayNames[d]).join(', ') || 'Specific Days';
    }

    return `
      <div class="card habit-card ${isTodayDone ? 'is-today-done' : ''}" id="habitCard-${h.id}" data-id="${h.id}">
        <!-- Top Row: Icon, Info & Action -->
        <div class="habit-card__top">
          <div class="habit-card__icon" style="background:${h.color}; color:#fff">
            ${App.escapeHtml(h.icon || '⚡')}
          </div>
          <div class="habit-card__info">
            <h3 class="habit-card__title">${App.escapeHtml(h.name)}</h3>
            ${h.description ? `<p class="habit-card__desc">${App.escapeHtml(h.description)}</p>` : ''}
            <div class="habit-card__tags">
              ${subj ? `<a href="subjects.html?focus=${encodeURIComponent(subj.id)}" class="badge badge-subject" style="border-left: 3px solid ${subj.color}">● ${App.escapeHtml(subj.name)}</a>` : ''}
              <span class="badge badge-muted">${freqLabel}</span>
              <span class="badge ${currentStreak > 0 ? 'badge-streak' : 'badge-muted'}" title="Current Streak: ${currentStreak} days">🔥 ${currentStreak} ${currentStreak === 1 ? 'day' : 'days'}</span>
              ${bestStreak > 0 ? `<span class="badge badge-muted" title="All-time Best Streak: ${bestStreak} days">⭐ Best: ${bestStreak}</span>` : ''}
            </div>
          </div>

          <!-- Today's Toggle Button / State -->
          <div class="habit-card__check-wrap">
            ${!h.archived ? (
              isTodayScheduled ? `
                <button type="button" class="btn habit-check-btn ${isTodayDone ? 'btn-success is-done' : 'btn-ghost'}"
                  data-toggle-habit="${h.id}"
                  aria-label="${isTodayDone ? `Habit ${App.escapeHtml(h.name)} is completed today. Click to undo.` : `Mark habit ${App.escapeHtml(h.name)} complete for today`}">
                  ${isTodayDone ? `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>Done</span>
                  ` : `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/></svg>
                    <span>Complete</span>
                  `}
                </button>
              ` : `
                <span class="badge badge-muted habit-rest-badge">Rest Day</span>
              `
            ) : `
              <span class="badge badge-muted">Archived</span>
            `}
          </div>
        </div>

        <!-- Middle: 7-Day Current Week Strip (Mon–Sun) -->
        <div class="habit-card__week-section">
          <div class="habit-week-title flex-between">
            <small class="text-muted">This Week's Consistency</small>
            <small class="text-muted font-bold">${weeklyStatus.filter(d => d.isCompleted).length} / ${weeklyStatus.filter(d => d.isScheduled).length} done</small>
          </div>
          <div class="habit-week-strip" role="group" aria-label="Current week status for ${App.escapeHtml(h.name)}">
            ${weeklyStatus.map(d => {
              const isToday = d.date === todayISO;
              let dotClass = 'dot-unscheduled';
              let symbol = '—';
              let label = `${d.dayName}, ${Dates.formatShort(d.date)}: Not scheduled`;

              if (d.status === 'completed') {
                dotClass = 'dot-completed';
                symbol = '✓';
                label = `${d.dayName}, ${Dates.formatShort(d.date)}: Completed`;
              } else if (d.status === 'pending') {
                dotClass = 'dot-pending';
                symbol = '○';
                label = `${d.dayName}, ${Dates.formatShort(d.date)}: Pending today`;
              } else if (d.status === 'missed') {
                dotClass = 'dot-missed';
                symbol = '•';
                label = `${d.dayName}, ${Dates.formatShort(d.date)}: Missed`;
              } else if (d.status === 'future') {
                dotClass = 'dot-future';
                symbol = '•';
                label = `${d.dayName}, ${Dates.formatShort(d.date)}: Scheduled`;
              }

              return `
                <div class="week-col ${isToday ? 'is-today' : ''}" title="${label}" aria-label="${label}">
                  <span class="week-day-lbl">${d.dayName}</span>
                  <span class="week-dot ${dotClass}" aria-hidden="true">${symbol}</span>
                  <span class="week-day-num">${d.date.slice(8)}</span>
                </div>`;
            }).join('')}
          </div>
        </div>

        <!-- Bottom: Actions -->
        <div class="habit-card__actions">
          ${!h.archived ? `
            <button type="button" class="btn btn-ghost btn-sm" data-edit="${h.id}" aria-label="Edit habit ${App.escapeHtml(h.name)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              <span>Edit</span>
            </button>
            <button type="button" class="btn btn-ghost btn-sm text-muted" data-archive="${h.id}" aria-label="Archive habit ${App.escapeHtml(h.name)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>
              <span>Archive</span>
            </button>
          ` : `
            <button type="button" class="btn btn-ghost btn-sm" data-restore="${h.id}" aria-label="Restore habit ${App.escapeHtml(h.name)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              <span>Restore</span>
            </button>
            <button type="button" class="btn btn-ghost btn-sm text-danger" data-delete="${h.id}" aria-label="Permanently delete habit ${App.escapeHtml(h.name)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
              <span>Delete Permanently</span>
            </button>
          `}
        </div>
      </div>`;
  }).join('');

  // Bind inline complete toggle
  App.qsa('[data-toggle-habit]', container).forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.toggleHabit;
      const isDone = Store.toggleHabitCompletion(id, Dates.todayISO());
      if (isDone) App.playChime('finish');
      renderAllHabitsData();
    });
  });

  // Bind edit
  App.qsa('[data-edit]', container).forEach(btn => {
    btn.addEventListener('click', () => openHabitModal(btn.dataset.edit));
  });

  // Bind archive
  App.qsa('[data-archive]', container).forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.archive;
      const habit = Store.getHabit(id);
      if (!habit) return;
      Store.archiveHabit(id);
      App.toast(`Habit "${habit.name}" archived.`, 'info');
      renderAllHabitsData();
    });
  });

  // Bind restore
  App.qsa('[data-restore]', container).forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.restore;
      const habit = Store.getHabit(id);
      if (!habit) return;
      Store.restoreHabit(id);
      App.toast(`Habit "${habit.name}" restored to active list.`, 'success');
      renderAllHabitsData();
    });
  });

  // Bind delete permanently
  App.qsa('[data-delete]', container).forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.delete;
      const habit = Store.getHabit(id);
      if (!habit) return;
      App.confirm({
        title: 'Delete Habit Permanently?',
        message: `Permanently remove "${habit.name}" and all of its recorded completions? This cannot be undone.`,
        confirmText: 'Delete Permanently',
        danger: true,
        onConfirm: () => {
          Store.deleteHabit(id);
          App.toast(`Habit "${habit.name}" deleted.`, 'info');
          renderAllHabitsData();
        }
      });
    });
  });
}

/* ---- 3. 30-Day Consistency History Section ------------------------------- */
function renderHistoryMatrix() {
  const container = App.qs('#historyContent');
  if (!container) return;

  const activeHabits = Store.getHabits(false);
  if (activeHabits.length === 0) {
    container.innerHTML = `<p class="text-muted p-4 text-center">Create active habits to inspect 30-day consistency history.</p>`;
    return;
  }

  // Generate last 30 days
  const todayISO = Dates.todayISO();
  const todayDate = Dates.parse(todayISO);
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(todayDate);
    d.setDate(todayDate.getDate() - i);
    days.push(Dates.toISO(d));
  }

  let html = `
    <div class="history-matrix-scroll">
      <table class="history-table" aria-label="30-day habit completion matrix">
        <thead>
          <tr>
            <th class="history-th-habit">Habit</th>
            ${days.map(d => `<th class="history-th-day ${d === todayISO ? 'is-today' : ''}" title="${Dates.formatShort(d)}">${d.slice(8)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>`;

  activeHabits.forEach(h => {
    html += `
      <tr>
        <td class="history-td-habit">
          <span class="history-habit-icon">${App.escapeHtml(h.icon || '⚡')}</span>
          <span class="history-habit-name" title="${App.escapeHtml(h.name)}">${App.escapeHtml(h.name)}</span>
        </td>
        ${days.map(dStr => {
          const dObj = Dates.parse(dStr);
          const isSched = Store.isHabitScheduledOn(h, dObj);
          const isDone = Store.isHabitCompletedOnDate(h.id, dStr);
          let cellCls = 'matrix-cell--off';
          let title = `${App.escapeHtml(h.name)} on ${Dates.formatShort(dStr)}: Not scheduled`;

          if (isSched) {
            if (isDone) {
              cellCls = 'matrix-cell--done';
              title = `${App.escapeHtml(h.name)} on ${Dates.formatShort(dStr)}: Completed`;
            } else if (dStr < todayISO) {
              cellCls = 'matrix-cell--missed';
              title = `${App.escapeHtml(h.name)} on ${Dates.formatShort(dStr)}: Incomplete`;
            } else {
              cellCls = 'matrix-cell--pending';
              title = `${App.escapeHtml(h.name)} on ${Dates.formatShort(dStr)}: Pending today`;
            }
          }

          return `<td class="history-td-cell"><span class="matrix-box ${cellCls}" title="${title}"></span></td>`;
        }).join('')}
      </tr>`;
  });

  html += `
        </tbody>
      </table>
    </div>
    <div class="history-legend mt-3">
      <span><span class="matrix-box matrix-cell--done inline-box"></span> Completed</span>
      <span><span class="matrix-box matrix-cell--pending inline-box"></span> Scheduled today</span>
      <span><span class="matrix-box matrix-cell--missed inline-box"></span> Incomplete past</span>
      <span><span class="matrix-box matrix-cell--off inline-box"></span> Rest / Unscheduled</span>
    </div>`;

  container.innerHTML = html;
}

/* ==========================================================================
   Create / Edit Habit Modal
   ========================================================================== */
function bindModal() {
  const modal = App.qs('#habitModal');
  if (!modal) return;
  App.bindModalClose(modal);

  const addBtn = App.qs('#addHabitBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => openHabitModal());
  }

  // Radio toggle for frequency
  App.qsa('input[name="habitFreq"]').forEach(r => {
    r.addEventListener('change', e => {
      const isWeekdays = e.target.value === 'weekdays';
      const picker = App.qs('#weekdayPickerField');
      if (picker) picker.style.display = isWeekdays ? 'block' : 'none';
    });
  });

  // Form submit
  const form = App.qs('#habitForm');
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      saveHabitFromForm();
    });
  }
}

function openHabitModal(editId = null) {
  const modal = App.qs('#habitModal');
  const titleEl = App.qs('#habitModalTitle');
  const editIdInput = App.qs('#habitEditId');
  const nameInput = App.qs('#habitName');
  const descInput = App.qs('#habitDesc');
  const subjInput = App.qs('#habitSubject');
  const weekdayField = App.qs('#weekdayPickerField');
  const weekdayError = App.qs('#weekdayError');

  if (weekdayError) weekdayError.style.display = 'none';
  App.qs('#hf-name').classList.remove('has-error');

  populateDropdowns();

  if (editId) {
    const habit = Store.getHabit(editId);
    if (!habit) return;

    if (titleEl) titleEl.textContent = 'Edit Habit';
    if (editIdInput) editIdInput.value = habit.id;
    if (nameInput) nameInput.value = habit.name;
    if (descInput) descInput.value = habit.description || '';
    if (subjInput) subjInput.value = habit.subjectId || '';

    habitsView.selectedColor = habit.color;
    habitsView.selectedIcon = habit.icon || '⚡';

    const freqRadio = App.qs(`input[name="habitFreq"][value="${habit.frequency}"]`);
    if (freqRadio) freqRadio.checked = true;

    if (weekdayField) {
      weekdayField.style.display = habit.frequency === 'weekdays' ? 'block' : 'none';
    }

    App.qsa('input[name="targetDay"]').forEach(cb => {
      const val = parseInt(cb.value, 10);
      cb.checked = Array.isArray(habit.targetDays) ? habit.targetDays.includes(val) : false;
    });
  } else {
    if (titleEl) titleEl.textContent = 'New Habit';
    if (editIdInput) editIdInput.value = '';
    if (nameInput) nameInput.value = '';
    if (descInput) descInput.value = '';
    if (subjInput) subjInput.value = '';

    habitsView.selectedColor = HABIT_COLORS[0];
    habitsView.selectedIcon = HABIT_EMOJIS[0];

    const freqDaily = App.qs('input[name="habitFreq"][value="daily"]');
    if (freqDaily) freqDaily.checked = true;
    if (weekdayField) weekdayField.style.display = 'none';

    // Default weekdays checked: Mon, Wed, Fri
    App.qsa('input[name="targetDay"]').forEach(cb => {
      const val = parseInt(cb.value, 10);
      cb.checked = [1, 3, 5].includes(val);
    });
  }

  // Update UI color swatches & emoji presets
  App.qsa('#habitColorSwatches .swatch').forEach(sw => {
    sw.classList.toggle('selected', sw.dataset.color === habitsView.selectedColor);
  });
  App.qsa('#emojiPresets .emoji-preset-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.emoji === habitsView.selectedIcon);
  });
  const customInput = App.qs('#habitCustomIcon');
  if (customInput) customInput.value = habitsView.selectedIcon;

  App.openModal(modal);
}

function saveHabitFromForm() {
  const editId = App.qs('#habitEditId').value.trim();
  const nameInput = App.qs('#habitName');
  const descInput = App.qs('#habitDesc');
  const subjInput = App.qs('#habitSubject');
  const freqVal = App.qs('input[name="habitFreq"]:checked').value;
  const customIcon = App.qs('#habitCustomIcon').value.trim();
  const weekdayError = App.qs('#weekdayError');

  const name = nameInput.value.trim();
  if (!name || name.length < 2) {
    App.qs('#hf-name').classList.add('has-error');
    nameInput.focus();
    return;
  }
  App.qs('#hf-name').classList.remove('has-error');

  let targetDays = [0, 1, 2, 3, 4, 5, 6];
  if (freqVal === 'weekdays') {
    const checkedDays = App.qsa('input[name="targetDay"]:checked').map(cb => parseInt(cb.value, 10));
    if (checkedDays.length === 0) {
      if (weekdayError) weekdayError.style.display = 'block';
      return;
    }
    targetDays = checkedDays;
  }
  if (weekdayError) weekdayError.style.display = 'none';

  const icon = customIcon || habitsView.selectedIcon || '⚡';
  const color = habitsView.selectedColor || HABIT_COLORS[0];

  const payload = {
    name,
    description: descInput.value.trim(),
    subjectId: subjInput.value,
    icon,
    color,
    frequency: freqVal,
    targetDays
  };

  if (editId) {
    payload.id = editId;
    Store.saveHabit(payload);
    App.toast(`Habit "${name}" updated.`, 'success');
  } else {
    Store.saveHabit(payload);
    App.toast(`Habit "${name}" created.`, 'success');
  }

  App.closeModal('#habitModal');
  renderAllHabitsData();
}

/* ==========================================================================
   Utilities
   ========================================================================== */
function resetHabitFilters() {
  habitsView.search = '';
  habitsView.frequency = 'all';
  habitsView.subject = 'all';

  const s = App.qs('#habitSearchInput');
  if (s) s.value = '';
  const f = App.qs('#filterFrequency');
  if (f) f.value = 'all';
  const sub = App.qs('#filterSubject');
  if (sub) sub.value = 'all';

  renderHabitsList();
}

function highlightFocusedHabit() {
  const params = new URLSearchParams(window.location.search);
  const focusId = params.get('focus');
  if (!focusId) return;

  const card = App.qs(`#habitCard-${focusId}`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('highlight-pulse');
    setTimeout(() => card.classList.remove('highlight-pulse'), 2500);
  }
}
