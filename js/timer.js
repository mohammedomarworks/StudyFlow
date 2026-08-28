/* ==========================================================================
   timer.js — Focus / Pomodoro Timer Logic
   Features: Pomodoro (25m), Short Break (5m), Long Break (15m),
   Subject & Task linking, SVG circular countdown, document title sync,
   Web Audio alerts on completion, background-safe interval, session logging.
   ========================================================================== */

const TIMER_RADIUS = 114;
const TIMER_CIRCUMFERENCE = 2 * Math.PI * TIMER_RADIUS; // ~716.28

const state = {
  mode: 'pomodoro',           // 'pomodoro' | 'shortBreak' | 'longBreak'
  isRunning: false,
  totalSeconds: 25 * 60,
  remainingSeconds: 25 * 60,
  endTime: null,
  intervalId: null
};

document.addEventListener('DOMContentLoaded', () => {
  readUrlParams();
  populateDropdowns();
  bindTimerControls();
  setMode('pomodoro');
  renderTodaySessions();
});

/* Read URL params (e.g. from task card "Focus" button) */
function readUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const subjectId = params.get('subjectId');
  const taskId = params.get('taskId');

  if (subjectId) state.prefillSubjectId = subjectId;
  if (taskId) state.prefillTaskId = taskId;
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

  if (state.prefillSubjectId) {
    subEl.value = state.prefillSubjectId;
  }

  updateTaskDropdown();

  subEl.addEventListener('change', () => {
    updateTaskDropdown();
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
   Timer Durations & Mode Switching
   ========================================================================== */
function getDurationForMode(mode) {
  const settings = Store.getSettings();
  const pomo = settings.pomodoro || { focus: 25, shortBreak: 5, longBreak: 15 };

  switch (mode) {
    case 'shortBreak': return (pomo.shortBreak || 5) * 60;
    case 'longBreak':  return (pomo.longBreak || 15) * 60;
    case 'pomodoro':
    default:           return (pomo.focus || 25) * 60;
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
  state.endTime = Date.now() + state.remainingSeconds * 1000;

  App.qs('#timerToggleBtn').classList.add('btn-running');
  App.qs('#timerToggleText').textContent = 'Pause';
  App.qs('#timerPlayIcon').innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';

  state.intervalId = setInterval(() => {
    const now = Date.now();
    const remaining = Math.max(0, Math.ceil((state.endTime - now) / 1000));
    state.remainingSeconds = remaining;
    updateDisplay();

    if (remaining <= 0) {
      completeTimer();
    }
  }, 250);
}

function pauseTimer() {
  if (!state.isRunning) return;

  state.isRunning = false;
  clearInterval(state.intervalId);
  state.intervalId = null;

  App.qs('#timerToggleBtn').classList.remove('btn-running');
  App.qs('#timerToggleText').textContent = state.mode === 'pomodoro' ? 'Resume Focus' : 'Resume Break';
  App.qs('#timerPlayIcon').innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
  document.title = 'StudyFlow — Focus Timer';
}

function resetTimer() {
  pauseTimer();
  state.remainingSeconds = state.totalSeconds;
  App.qs('#timerToggleText').textContent = state.mode === 'pomodoro' ? 'Start Focus' : 'Start Break';
  updateDisplay();
}

function completeTimer() {
  pauseTimer();
  App.playChime('finish');

  const durationMin = Math.round(state.totalSeconds / 60);

  if (state.mode === 'pomodoro') {
    const subjectId = App.qs('#timerSubject').value;
    const taskId = App.qs('#timerTask').value;

    Store.saveSession({
      mode: 'pomodoro',
      durationMinutes: durationMin,
      subjectId,
      taskId
    });

    App.toast(`Focus session complete (+${durationMin}m)! Great job! 🎉`, 'success');
    renderTodaySessions();
    setMode('shortBreak');
  } else {
    App.toast('Break completed! Ready for the next focus session?', 'info');
    setMode('pomodoro');
  }
}

/* ==========================================================================
   Controls Binding
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
}

/* ==========================================================================
   Today's Session History
   ========================================================================== */
function renderTodaySessions() {
  const today = Dates.todayISO();
  const sessions = Store.getSessions()
    .filter(s => (s.completedAt || '').startsWith(today))
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
        <button class="icon-btn danger btn-sm" data-delete-session="${s.id}" title="Remove session log">
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
      App.toast('Session log removed', 'info');
    });
  });
}
