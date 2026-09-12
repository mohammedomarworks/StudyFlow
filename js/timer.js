/* ==========================================================================
   timer.js — Focus / Pomodoro Timer Logic
   Features: Pomodoro, Short Break, Long Break, Subject & Task linking,
   Study Overview (Daily Goal & Weekly Summary), SVG circular countdown,
   Document title sync, Web Audio alerts on completion, background-safe
   endTime interval, session completion modal with next actions,
   and keyboard accessibility.

   Refresh behavior: the running countdown state lives in memory and is derived
   from state.endTime (clock-drift & background-tab safe). Only fully completed
   focus sessions are logged to LocalStorage.
   ========================================================================== */

const TIMER_RADIUS = 114;
const TIMER_CIRCUMFERENCE = 2 * Math.PI * TIMER_RADIUS; // ~716.28

const state = {
  mode: 'pomodoro',           // 'pomodoro' | 'shortBreak' | 'longBreak'
  isRunning: false,
  totalSeconds: 25 * 60,
  remainingSeconds: 25 * 60,
  endTime: null,
  intervalId: null,
  isCompleting: false         // guard so a session is never logged twice
};

document.addEventListener('DOMContentLoaded', () => {
  readUrlParams();
  populateDropdowns();
  bindTimerControls();
  bindModalActions();
  setMode('pomodoro');
  renderOverview();
  renderFocusContext();
  renderTodaySessions();
  updateStartPreview();
  maybeAutostart();
});

/* Keep the timestamp-based countdown correct when returning to a backgrounded
   tab (setInterval is throttled while hidden). */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.isRunning) tick();
});

/* Read URL params (e.g. from task card "Start Focus" button or subject card) */
function readUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const subjectId = params.get('subjectId');
  const taskId = params.get('taskId');

  if (taskId) {
    const task = Store.getTask(taskId);
    if (task) {
      state.prefillTaskId = taskId;
      if (task.subjectId && !subjectId) {
        state.prefillSubjectId = task.subjectId;
      }
    }
  }

  if (subjectId && !state.prefillSubjectId) {
    const subject = Store.getSubject(subjectId);
    if (subject) {
      state.prefillSubjectId = subjectId;
    }
  }

  if (params.get('autostart') === '1') {
    state.autostart = true;
  }
}

/* ==========================================================================
   Dropdowns: Subjects & Tasks
   ========================================================================== */
function populateDropdowns() {
  const subjects = Store.getSubjects();
  const subEl = App.qs('#timerSubject');
  const taskEl = App.qs('#timerTask');

  subEl.innerHTML = '<option value="">— General Study —</option>' +
    subjects.map(s => `<option value="${s.id}">${App.escapeHtml(s.name)}</option>`).join('');

  if (state.prefillSubjectId && subjects.some(s => s.id === state.prefillSubjectId)) {
    subEl.value = state.prefillSubjectId;
  }

  updateTaskDropdown();

  subEl.addEventListener('change', () => {
    updateTaskDropdown();
    renderFocusContext();
    updateStartPreview();
  });
  taskEl.addEventListener('change', () => {
    renderFocusContext();
    updateStartPreview();
  });
}

function updateTaskDropdown() {
  const subId = App.qs('#timerSubject').value;
  const taskEl = App.qs('#timerTask');
  let tasks = Store.getTasks().filter(t => !t.completed);

  if (subId) {
    tasks = tasks.filter(t => t.subjectId === subId);
  }

  taskEl.innerHTML = '<option value="">— No specific task —</option>' +
    tasks.map(t => `<option value="${t.id}">${App.escapeHtml(t.title)}</option>`).join('');

  if (state.prefillTaskId && tasks.some(t => t.id === state.prefillTaskId)) {
    taskEl.value = state.prefillTaskId;
  }
}

/* ==========================================================================
   Study Overview Strip: Daily Focus & Goal + Weekly Summary
   ========================================================================== */
function renderOverview() {
  const study = Store.getStudyStats();
  const settings = Store.getSettings();
  const dailyGoal = settings.pomodoro && settings.pomodoro.dailyGoal != null ? settings.pomodoro.dailyGoal : 120;

  // 1. Today card
  const todayMinsEl = App.qs('#timerTodayMinutes');
  const todaySessionsEl = App.qs('#timerTodaySessions');
  const streakBadgeEl = App.qs('#timerStreakBadge');

  if (todayMinsEl) todayMinsEl.textContent = Dates.formatDuration(study.todayMinutes);
  if (todaySessionsEl) todaySessionsEl.textContent = study.todaySessionsCount;
  if (streakBadgeEl) {
    streakBadgeEl.textContent = study.streakDays > 0 ? `🔥 ${study.streakDays}-day streak` : '🔥 0-day streak';
  }

  // Daily goal calculation
  const goalLabel = App.qs('#timerGoalLabel');
  const goalPercent = App.qs('#timerGoalPercent');
  const goalFill = App.qs('#timerGoalFill');
  const goalRemaining = App.qs('#timerGoalRemaining');

  if (dailyGoal > 0) {
    const pct = Math.min(100, Math.round((study.todayMinutes / dailyGoal) * 100));
    if (goalLabel) goalLabel.textContent = `Daily Goal: ${Dates.formatDuration(dailyGoal)}`;
    if (goalPercent) goalPercent.textContent = `${pct}%`;
    if (goalFill) {
      goalFill.style.width = `${pct}%`;
      goalFill.classList.toggle('is-complete', pct >= 100);
    }
    if (goalRemaining) {
      if (study.todayMinutes >= dailyGoal) {
        goalRemaining.innerHTML = `<b style="color:var(--success)">🎉 Daily goal achieved!</b> (${Dates.formatDuration(study.todayMinutes)} focused)`;
      } else {
        const left = dailyGoal - study.todayMinutes;
        goalRemaining.textContent = `${Dates.formatDuration(left)} remaining to reach your goal`;
      }
    }
  } else {
    if (goalLabel) goalLabel.textContent = 'Daily Goal: Disabled';
    if (goalPercent) goalPercent.textContent = '—';
    if (goalFill) goalFill.style.width = '0%';
    if (goalRemaining) goalRemaining.textContent = 'Daily goal is disabled in Settings.';
  }

  // 2. Weekly card
  const weekly = Store.getWeeklyStudyStats();
  const weekMinsEl = App.qs('#timerWeeklyMinutes');
  const weekAvgEl = App.qs('#timerWeeklyAvg');
  const weekSessionsBadge = App.qs('#timerWeeklySessionsBadge');
  const weekTopSubjEl = App.qs('#timerWeeklyTopSubject');

  if (weekMinsEl) weekMinsEl.textContent = Dates.formatDuration(weekly.totalMinutes);
  if (weekAvgEl) weekAvgEl.textContent = `${weekly.avgMinutes}m`;
  if (weekSessionsBadge) {
    weekSessionsBadge.textContent = `${weekly.sessionCount} ${weekly.sessionCount === 1 ? 'session' : 'sessions'}`;
  }
  if (weekTopSubjEl) {
    if (weekly.mostStudiedSubject) {
      weekTopSubjEl.innerHTML = `
        <span class="dot" style="background:${weekly.mostStudiedSubject.color}"></span>
        <b>${App.escapeHtml(weekly.mostStudiedSubject.name)}</b>
        <span class="text-muted">(${Dates.formatDuration(weekly.mostStudiedMinutes)})</span>`;
    } else {
      weekTopSubjEl.innerHTML = '<span class="text-muted">No focus logged yet</span>';
    }
  }
}

/* ==========================================================================
   Focus Context (Task Estimate vs Investment & Subject Weekly Minutes)
   ========================================================================== */
function renderFocusContext() {
  const box = App.qs('#timerContext');
  if (!box) return;

  const subject = Store.getSubject(App.qs('#timerSubject').value);
  const task = Store.getTask(App.qs('#timerTask').value);

  if (!subject && !task) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }

  box.hidden = false;
  const parts = [];

  if (task) {
    const investedMin = Store.getTaskStudyMinutes(task.id);
    let taskMeta = `<b>${App.escapeHtml(task.title)}</b>`;
    if (task.estimatedMinutes) {
      taskMeta += ` <span class="timer-context__badge">⏱️ ${investedMin}m focused / ${task.estimatedMinutes}m est.</span>`;
    } else if (investedMin > 0) {
      taskMeta += ` <span class="timer-context__badge">⏱️ ${investedMin}m focused</span>`;
    }
    parts.push(taskMeta);
  }

  if (subject) {
    const weeklyMin = Store.getSubjectWeeklyMinutes(subject.id);
    let subjMeta = `<span class="dot" style="background:${subject.color}"></span><span>${App.escapeHtml(subject.name)}</span>`;
    if (weeklyMin > 0) {
      subjMeta += ` <span class="timer-context__badge text-muted">(${Dates.formatDuration(weeklyMin)} this week)</span>`;
    }
    parts.push(subjMeta);
  }

  box.innerHTML = `<span class="timer-context__icon">🎯</span> <div class="timer-context__info flex wrap gap-2 align-center">${parts.join(' <span class="text-muted">·</span> ')}</div>`;
}

/* Update Session Start Preview Banner */
function updateStartPreview() {
  const banner = App.qs('#timerPreviewBanner');
  if (!banner) return;

  const durationMin = Math.round(state.totalSeconds / 60);
  const subject = Store.getSubject(App.qs('#timerSubject')?.value);
  const task = Store.getTask(App.qs('#timerTask')?.value);

  if (state.mode === 'pomodoro') {
    if (task && subject) {
      banner.innerHTML = `Planned: <b>${durationMin}m Focus</b> on <i>"${App.escapeHtml(task.title)}"</i> (${App.escapeHtml(subject.name)})`;
    } else if (task) {
      banner.innerHTML = `Planned: <b>${durationMin}m Focus</b> on <i>"${App.escapeHtml(task.title)}"</i>`;
    } else if (subject) {
      banner.innerHTML = `Planned: <b>${durationMin}m Focus</b> on <b>${App.escapeHtml(subject.name)}</b>`;
    } else {
      banner.innerHTML = `Planned: <b>${durationMin}m General Focus Session</b>`;
    }
  } else if (state.mode === 'shortBreak') {
    banner.innerHTML = `Planned: <b>${durationMin}m Short Break ☕</b>`;
  } else if (state.mode === 'longBreak') {
    banner.innerHTML = `Planned: <b>${durationMin}m Long Break 🌿</b>`;
  }
}

/* If launched from a task "Start Focus" button, begin the session right away. */
function maybeAutostart() {
  if (state.autostart && state.mode === 'pomodoro' && !state.isRunning) {
    startTimer();
    const task = Store.getTask(App.qs('#timerTask').value);
    if (task) App.toast(`Focus session started for "${task.title}"`, 'info');
  }
}

/* ==========================================================================
   Timer Durations & Mode Switching
   ========================================================================== */
function getDurationForMode(mode) {
  const pomo = Store.getSettings().pomodoro;
  switch (mode) {
    case 'shortBreak': return pomo.shortBreak * 60;
    case 'longBreak':  return pomo.longBreak * 60;
    case 'pomodoro':
    default:           return pomo.focus * 60;
  }
}

function setMode(mode) {
  pauseTimer();
  state.mode = mode;
  state.totalSeconds = getDurationForMode(mode);
  state.remainingSeconds = state.totalSeconds;

  // Update mode tabs
  App.qsa('.timer-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  // Hide paused badge on mode change
  const pausedBadge = App.qs('#timerPausedBadge');
  if (pausedBadge) pausedBadge.style.display = 'none';

  // Update labels
  const labels = {
    pomodoro: 'Ready to Focus',
    shortBreak: 'Time for a Short Break ☕',
    longBreak: 'Time for a Long Break 🌿'
  };
  App.qs('#timerStatusLabel').textContent = labels[mode] || 'Ready';

  // Update button text
  App.qs('#timerToggleText').textContent = mode === 'pomodoro' ? 'Start Focus' : 'Start Break';

  updateDisplay();
  updateStartPreview();
}

/* ==========================================================================
   Timer Display & Circle Progress
   ========================================================================== */
function updateDisplay() {
  const mins = Math.floor(state.remainingSeconds / 60);
  const secs = state.remainingSeconds % 60;
  const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  App.qs('#timerDisplay').textContent = timeStr;

  // Circular ring dashoffset
  const fraction = state.totalSeconds > 0 ? (state.remainingSeconds / state.totalSeconds) : 0;
  const offset = TIMER_CIRCUMFERENCE * (1 - fraction);
  const bar = App.qs('#timerBar');
  if (bar) {
    bar.style.strokeDashoffset = offset;
  }

  // Document title
  if (state.isRunning) {
    document.title = `(${timeStr}) StudyFlow Focus`;
  } else {
    document.title = 'StudyFlow — Focus Timer';
  }
}

/* ==========================================================================
   Timer Engine (Clock drift safe using EndTime)
   ========================================================================== */
function startTimer() {
  if (state.isRunning) return;

  state.isRunning = true;
  state.isCompleting = false;
  state.endTime = Date.now() + state.remainingSeconds * 1000;

  const pausedBadge = App.qs('#timerPausedBadge');
  if (pausedBadge) pausedBadge.style.display = 'none';

  App.qs('#timerToggleBtn').classList.add('btn-running');
  App.qs('#timerToggleText').textContent = 'Pause';
  App.qs('#timerPlayIcon').innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';

  state.intervalId = setInterval(tick, 250);
}

/* One countdown step — derives remaining time from endTime (drift/throttle safe) */
function tick() {
  const remaining = Math.max(0, Math.ceil((state.endTime - Date.now()) / 1000));
  state.remainingSeconds = remaining;
  updateDisplay();
  if (remaining <= 0) completeTimer();
}

function pauseTimer() {
  if (!state.isRunning) return;

  state.isRunning = false;
  clearInterval(state.intervalId);
  state.intervalId = null;

  App.qs('#timerToggleBtn').classList.remove('btn-running');
  App.qs('#timerToggleText').textContent = state.mode === 'pomodoro' ? 'Resume Focus' : 'Resume Break';
  App.qs('#timerPlayIcon').innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';

  const pausedBadge = App.qs('#timerPausedBadge');
  if (pausedBadge && state.remainingSeconds < state.totalSeconds) {
    pausedBadge.style.display = 'inline-block';
  }

  document.title = 'StudyFlow — Focus Timer';
}

function resetTimer() {
  pauseTimer();
  state.remainingSeconds = state.totalSeconds;
  const pausedBadge = App.qs('#timerPausedBadge');
  if (pausedBadge) pausedBadge.style.display = 'none';

  App.qs('#timerToggleText').textContent = state.mode === 'pomodoro' ? 'Start Focus' : 'Start Break';
  updateDisplay();
}

/* Session Completion Logic — Exactly-once logging */
function completeTimer() {
  if (state.isCompleting) return;
  state.isCompleting = true;

  pauseTimer();
  App.playChime('finish');

  const durationMin = Math.round(state.totalSeconds / 60);

  if (state.mode === 'pomodoro') {
    const subjectId = App.qs('#timerSubject').value || null;
    const taskId = App.qs('#timerTask').value || null;

    Store.saveSession({
      type: 'focus',
      durationMinutes: durationMin,
      subjectId,
      taskId
    });

    const task = Store.getTask(taskId);
    App.toast(
      task
        ? `Focus session on "${task.title}" complete (+${durationMin}m)! 🎉`
        : `Focus session complete (+${durationMin}m)! Great job! 🎉`,
      'success'
    );

    renderOverview();
    renderTodaySessions();
    renderFocusContext();

    const autoBreak = Store.getSettings().pomodoro.autoBreak;
    if (autoBreak) {
      setMode('shortBreak');
      startTimer();
    } else {
      openSessionCompleteModal(durationMin, subjectId, taskId);
    }
  } else {
    App.toast('Break completed! Ready for the next focus session?', 'info');
    setMode('pomodoro');
  }
}

/* ==========================================================================
   Session Completion Modal
   ========================================================================== */
function openSessionCompleteModal(durationMin, subjectId, taskId) {
  const modal = App.qs('#sessionCompleteModal');
  if (!modal) return;

  const subject = Store.getSubject(subjectId);
  const task = Store.getTask(taskId);
  const settings = Store.getSettings();
  const pomo = settings.pomodoro;
  const breakMin = pomo.shortBreak || 5;

  const breakMinSpan = App.qs('#modalBreakMinutes');
  if (breakMinSpan) breakMinSpan.textContent = breakMin;

  const summaryEl = App.qs('#sessionCompleteSummary');
  if (summaryEl) {
    let focusDetail = 'deep focus';
    if (task && subject) {
      focusDetail = `focus on <b>${App.escapeHtml(task.title)}</b> (${App.escapeHtml(subject.name)})`;
    } else if (task) {
      focusDetail = `focus on <b>${App.escapeHtml(task.title)}</b>`;
    } else if (subject) {
      focusDetail = `focus on <b>${App.escapeHtml(subject.name)}</b>`;
    }
    summaryEl.innerHTML = `You completed <b>+${durationMin} minutes</b> of ${focusDetail}! Excellent progress.`;
  }

  // Updated stats
  const study = Store.getStudyStats();
  const dailyGoal = pomo.dailyGoal != null ? pomo.dailyGoal : 120;
  const statsBox = App.qs('#sessionCompleteStats');
  if (statsBox) {
    let goalStatusHtml = '';
    if (dailyGoal > 0) {
      const pct = Math.min(100, Math.round((study.todayMinutes / dailyGoal) * 100));
      goalStatusHtml = `
        <div class="session-modal-stat-card">
          <small class="text-muted">Goal Progress</small>
          <b>${pct}%</b>
          <div class="timer-progress-track mt-1" style="height:4px">
            <div class="timer-progress-fill" style="width:${pct}%"></div>
          </div>
        </div>`;
    }
    statsBox.innerHTML = `
      <div class="session-modal-stats-grid">
        <div class="session-modal-stat-card">
          <small class="text-muted">Today's Focus</small>
          <b>${Dates.formatDuration(study.todayMinutes)}</b>
        </div>
        <div class="session-modal-stat-card">
          <small class="text-muted">Study Streak</small>
          <b>${study.streakDays} ${study.streakDays === 1 ? 'day' : 'days'}</b>
        </div>
        ${goalStatusHtml}
      </div>`;
  }

  modal.hidden = false;
  modal.classList.add('active');

  // Focus trap / initial focus on Break button
  const breakBtn = App.qs('#modalStartBreakBtn');
  if (breakBtn) breakBtn.focus();
}

function closeSessionCompleteModal() {
  const modal = App.qs('#sessionCompleteModal');
  if (!modal) return;
  modal.hidden = true;
  modal.classList.remove('active');
}

function bindModalActions() {
  const modal = App.qs('#sessionCompleteModal');
  if (!modal) return;

  // Start break button
  App.qs('#modalStartBreakBtn')?.addEventListener('click', () => {
    closeSessionCompleteModal();
    setMode('shortBreak');
    startTimer();
  });

  // Start another focus button
  App.qs('#modalStartFocusBtn')?.addEventListener('click', () => {
    closeSessionCompleteModal();
    setMode('pomodoro');
    resetTimer();
    startTimer();
  });

  // Done button / backdrop
  App.qsa('[data-modal-close]', modal).forEach(btn => {
    btn.addEventListener('click', () => {
      closeSessionCompleteModal();
      setMode('shortBreak');
    });
  });
}

/* ==========================================================================
   Controls Binding & Keyboard Accessibility
   ========================================================================== */
function bindTimerControls() {
  // Mode Tabs
  App.qsa('.timer-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setMode(btn.dataset.mode);
    });
  });

  // Toggle Play/Pause
  App.qs('#timerToggleBtn').addEventListener('click', () => {
    if (state.isRunning) {
      pauseTimer();
    } else {
      startTimer();
    }
  });

  // Reset
  App.qs('#timerResetBtn').addEventListener('click', () => {
    resetTimer();
  });

  // Skip
  App.qs('#timerSkipBtn').addEventListener('click', () => {
    if (state.mode === 'pomodoro') {
      setMode('shortBreak');
    } else {
      setMode('pomodoro');
    }
  });

  // Keyboard accessibility
  window.addEventListener('keydown', e => {
    const modal = App.qs('#sessionCompleteModal');
    if (modal && !modal.hidden) {
      if (e.key === 'Escape') {
        closeSessionCompleteModal();
        setMode('shortBreak');
      }
      return;
    }

    const activeTag = document.activeElement?.tagName;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(activeTag)) return;

    if (e.code === 'Space') {
      e.preventDefault();
      if (state.isRunning) {
        pauseTimer();
      } else {
        startTimer();
      }
    }
  });
}

/* ==========================================================================
   Today's Session History
   ========================================================================== */
function renderTodaySessions() {
  const today = Dates.todayISO();
  const sessions = Store.getSessions()
    .filter(s => s.type === 'focus' && Dates.toISO(new Date(s.completedAt)) === today)
    .reverse();

  const totalMin = sessions.reduce((acc, s) => acc + (Number(s.durationMinutes) || 0), 0);
  App.qs('#todayFocusBadge').textContent = `${Dates.formatDuration(totalMin)} today`;

  const box = App.qs('#sessionHistoryList');

  if (!sessions.length) {
    box.innerHTML = `
      <div class="empty" style="padding:var(--space-5) 0">
        <div class="empty__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>
        <h3>No sessions today yet</h3>
        <p>Start the timer to log your first study session of the day.</p>
      </div>`;
    return;
  }

  box.innerHTML = sessions.map(s => {
    const subject = Store.getSubject(s.subjectId);
    const task = Store.getTask(s.taskId);
    const timeStr = s.completedAt ? new Date(s.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    return `
      <div class="activity-item" data-session-id="${s.id}">
        <div class="activity-icon">⏱️</div>
        <div class="activity-content">
          <div class="activity-title">
            <b>${s.durationMinutes}m Focus Session</b>
            ${subject ? `<span class="badge badge-muted" style="margin-left:6px"><span class="dot" style="background:${subject.color}"></span>${App.escapeHtml(subject.name)}</span>` : ''}
          </div>
          <div class="activity-time">
            ${task ? `Task: ${App.escapeHtml(task.title)} · ` : ''}Finished at ${timeStr}
          </div>
        </div>
        <button class="icon-btn danger btn-sm" data-delete-session="${s.id}" title="Remove session log" aria-label="Remove focus session log">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>`;
  }).join('');

  // Wire session deletion
  App.qsa('[data-delete-session]', box).forEach(btn => {
    btn.addEventListener('click', () => {
      const sId = btn.dataset.deleteSession;
      Store.deleteSession(sId);
      renderTodaySessions();
      renderOverview();
      renderFocusContext();
      App.toast('Session log removed', 'info');
    });
  });
}
