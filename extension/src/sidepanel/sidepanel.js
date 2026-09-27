/* ==========================================================================
   sidepanel.js — Side Panel Application Controller (StudyFlow v2.1.0)
   --------------------------------------------------------------------------
   Orchestrates authentication, today's tasks, quick task creation,
   realtime sync, offline handling, and theme state.
   ========================================================================== */

import { CONFIG } from '../shared/config.js';
import * as auth from '../shared/auth.js';
import * as api from '../shared/api.js';
import * as ft from '../shared/focus-timer.js';

const TIMER_STORAGE_KEY = 'studyflow_focus_timer';
const TIMER_SETTINGS_KEY = 'studyflow_focus_settings';

// Application State
const state = {
  currentUser: null,
  tasks: [],
  habits: [],
  subjects: [],
  settings: null,
  realtimeUnsubscribe: null,
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  theme: 'dark',
  // Focus timer
  timer: null,            // current focus-timer state object (see focus-timer.js)
  timerDurations: { ...ft.DEFAULT_DURATIONS },
  timerInterval: null     // render tick handle (display only; truth is endTime)
};

// DOM Elements
const DOM = {
  themeToggleBtn: document.getElementById('themeToggleBtn'),
  themeIcon: document.getElementById('themeIcon'),
  authActionBtn: document.getElementById('authActionBtn'),
  statusBanner: document.getElementById('statusBanner'),

  // Auth Section
  authSection: document.getElementById('authSection'),
  signInForm: document.getElementById('signInForm'),
  authEmail: document.getElementById('authEmail'),
  authPassword: document.getElementById('authPassword'),
  authErrorMsg: document.getElementById('authErrorMsg'),
  signInSubmitBtn: document.getElementById('signInSubmitBtn'),

  // App Section
  appSection: document.getElementById('appSection'),
  userGreeting: document.getElementById('userGreeting'),
  userEmail: document.getElementById('userEmail'),
  cloudStatusBadge: document.getElementById('cloudStatusBadge'),
  cloudStatusText: document.getElementById('cloudStatusText'),
  progressRatio: document.getElementById('progressRatio'),
  progressBarFill: document.getElementById('progressBarFill'),

  // Tasks
  toggleQuickAddBtn: document.getElementById('toggleQuickAddBtn'),
  quickAddForm: document.getElementById('quickAddForm'),
  newTaskTitle: document.getElementById('newTaskTitle'),
  newTaskSubject: document.getElementById('newTaskSubject'),
  newTaskPriority: document.getElementById('newTaskPriority'),
  newTaskDueDate: document.getElementById('newTaskDueDate'),
  quickAddError: document.getElementById('quickAddError'),
  cancelQuickAddBtn: document.getElementById('cancelQuickAddBtn'),
  saveQuickAddBtn: document.getElementById('saveQuickAddBtn'),
  tasksList: document.getElementById('tasksList'),

  // Habits
  habitsList: document.getElementById('habitsList'),
  habitsRatio: document.getElementById('habitsRatio'),

  // Launchers
  startFocusBtn: document.getElementById('startFocusBtn'),
  openStudyFlowBtn: document.getElementById('openStudyFlowBtn'),

  // Focus Timer
  focusCard: document.getElementById('focusCard'),
  focusStateBadge: document.getElementById('focusStateBadge'),
  focusTimerDisplay: document.getElementById('focusTimerDisplay'),
  focusCompleteMsg: document.getElementById('focusCompleteMsg'),
  focusSaveNote: document.getElementById('focusSaveNote'),
  focusSubjectSelect: document.getElementById('focusSubjectSelect'),
  focusTaskSelect: document.getElementById('focusTaskSelect'),
  focusStartBtn: document.getElementById('focusStartBtn'),
  focusPauseBtn: document.getElementById('focusPauseBtn'),
  focusResumeBtn: document.getElementById('focusResumeBtn'),
  focusResetBtn: document.getElementById('focusResetBtn'),
  focusBreakBtn: document.getElementById('focusBreakBtn'),
  focusSettings: document.getElementById('focusSettings'),
  focusMinFocus: document.getElementById('focusMinFocus'),
  focusMinShort: document.getElementById('focusMinShort'),
  focusMinLong: document.getElementById('focusMinLong'),
  focusSaveSettingsBtn: document.getElementById('focusSaveSettingsBtn')
};

/* ==========================================================================
   Initialization
   ========================================================================== */

document.addEventListener('DOMContentLoaded', async () => {
  await initTheme();
  initNetworkListeners();
  initEventListeners();
  initFocusTimerListeners();
  await checkAuthSession();
});

/* ==========================================================================
   Theme Management
   ========================================================================== */

async function initTheme() {
  let savedTheme = 'dark';
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try {
      const res = await chrome.storage.local.get(['studyflow_extension_theme']);
      if (res.studyflow_extension_theme) {
        savedTheme = res.studyflow_extension_theme;
      }
    } catch (e) {
      console.warn('[StudyFlow] Theme storage read failed:', e);
    }
  } else if (typeof localStorage !== 'undefined') {
    savedTheme = localStorage.getItem('studyflow_extension_theme') || 'dark';
  }

  applyTheme(savedTheme);
}

function applyTheme(theme) {
  state.theme = theme;
  let resolvedTheme = theme;
  if (theme === 'system') {
    resolvedTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', resolvedTheme);
}

async function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try {
      await chrome.storage.local.set({ studyflow_extension_theme: next });
    } catch {}
  } else if (typeof localStorage !== 'undefined') {
    localStorage.setItem('studyflow_extension_theme', next);
  }
}

/* ==========================================================================
   Network / Offline Management
   ========================================================================== */

function initNetworkListeners() {
  window.addEventListener('online', () => {
    state.isOnline = true;
    updateCloudStatus('connected');
    hideStatusBanner();
    if (state.currentUser) {
      loadDashboardData();
    }
  });

  window.addEventListener('offline', () => {
    state.isOnline = false;
    updateCloudStatus('offline');
    showStatusBanner('You are currently offline. Local views only.', 'warning');
  });

  updateCloudStatus(state.isOnline ? 'connected' : 'offline');
}

function updateCloudStatus(status) {
  if (!DOM.cloudStatusBadge || !DOM.cloudStatusText) return;
  const dot = DOM.cloudStatusBadge.querySelector('.status-dot');

  if (dot) {
    dot.className = 'status-dot';
  }

  if (status === 'connected') {
    DOM.cloudStatusText.textContent = 'Cloud ● Connected';
    if (dot) dot.classList.remove('offline', 'syncing');
  } else if (status === 'syncing') {
    DOM.cloudStatusText.textContent = 'Cloud ⟳ Syncing';
    if (dot) dot.classList.add('syncing');
  } else if (status === 'offline') {
    DOM.cloudStatusText.textContent = 'Cloud ○ Offline';
    if (dot) dot.classList.add('offline');
  } else if (status === 'disconnected') {
    DOM.cloudStatusText.textContent = 'Cloud ○ Disconnected';
    if (dot) dot.classList.add('offline');
  }

  // Update write button states when offline
  if (DOM.saveQuickAddBtn) {
    DOM.saveQuickAddBtn.disabled = !state.isOnline;
    DOM.saveQuickAddBtn.title = state.isOnline ? '' : 'Offline: reconnect to create tasks';
  }
}

function showStatusBanner(message, type = 'warning') {
  if (!DOM.statusBanner) return;
  DOM.statusBanner.textContent = message;
  DOM.statusBanner.className = `status-banner ${type}`;
}

function hideStatusBanner() {
  if (!DOM.statusBanner) return;
  DOM.statusBanner.className = 'status-banner hidden';
  DOM.statusBanner.textContent = '';
}

/* ==========================================================================
   Authentication & Session Lifecycle
   ========================================================================== */

async function checkAuthSession() {
  try {
    const user = await auth.getUser();
    if (user && user.id) {
      setAuthenticatedState(user);
      await loadDashboardData();
    } else {
      setUnauthenticatedState();
    }
  } catch (err) {
    console.error('[StudyFlow] Auth check failed:', err);
    setUnauthenticatedState();
  }

  // Listen for Supabase auth state transitions
  auth.onAuthStateChange(async (event, session, user) => {
    if (event === 'SIGNED_IN' && user) {
      setAuthenticatedState(user);
      await loadDashboardData();
    } else if (event === 'SIGNED_OUT' || !user) {
      setUnauthenticatedState();
    }
  });
}

function setAuthenticatedState(user) {
  state.currentUser = user;

  // Update greeting and email
  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = user.displayName || 'Student';

  DOM.userGreeting.textContent = `${timeGreeting}, ${name} 👋`;
  DOM.userEmail.textContent = user.email || '';
  DOM.authActionBtn.title = `Sign Out (${user.email})`;

  // Toggle visible sections
  DOM.authSection.classList.add('hidden');
  DOM.appSection.classList.remove('hidden');

  updateCloudStatus('connected');
  setupRealtimeSubscription(user.id);

  // Load timer prefs + restore any in-progress focus session for THIS user.
  loadTimerDurations().then(() => restoreTimerForUser(user.id));
}

function setUnauthenticatedState() {
  // Teardown previous subscription
  if (state.realtimeUnsubscribe) {
    state.realtimeUnsubscribe();
    state.realtimeUnsubscribe = null;
  }

  state.currentUser = null;
  state.tasks = [];
  state.subjects = [];

  // Focus timer: cancel + clear on sign-out so no session is ever written under
  // the next user, and no timer state leaks between accounts.
  cancelAndClearTimer();

  // Toggle visible sections
  DOM.appSection.classList.add('hidden');
  DOM.authSection.classList.remove('hidden');

  if (DOM.authActionBtn) {
    DOM.authActionBtn.title = 'Sign In';
  }

  updateCloudStatus('disconnected');
}

/* ==========================================================================
   Data Loading & Dashboard Rendering
   ========================================================================== */

async function loadDashboardData() {
  if (!state.currentUser || !state.isOnline) return;

  try {
    updateCloudStatus('syncing');

    // Default due date to today in quick add form
    if (DOM.newTaskDueDate) {
      DOM.newTaskDueDate.value = api.getTodayISO();
    }

    const [tasks, habits, subjects, settings] = await Promise.all([
      api.getTodayTasks().catch(err => {
        console.warn('[StudyFlow] Tasks load error:', err);
        return [];
      }),
      api.getTodayHabits().catch(err => {
        console.warn('[StudyFlow] Habits load error:', err);
        return [];
      }),
      api.getSubjects().catch(err => {
        console.warn('[StudyFlow] Subjects load error:', err);
        return [];
      }),
      api.getSettings().catch(err => {
        console.warn('[StudyFlow] Settings load error:', err);
        return null;
      })
    ]);

    state.tasks = tasks;
    state.habits = habits;
    state.subjects = subjects;
    state.settings = settings;

    renderSubjectDropdown();
    renderTasksList();
    renderProgress();
    renderHabitsList();
    renderFocusSelectors();
    applyCloudTimerDurations();
    updateCloudStatus('connected');
  } catch (err) {
    console.error('[StudyFlow] Error loading dashboard data:', err);
    updateCloudStatus('connected');
  }
}

function renderSubjectDropdown() {
  if (!DOM.newTaskSubject) return;

  // Preserve 'No Subject' as first option
  DOM.newTaskSubject.innerHTML = '<option value="">No Subject</option>';

  for (const s of state.subjects) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    DOM.newTaskSubject.appendChild(opt);
  }
}

function renderProgress() {
  const total = state.tasks.length;
  const completed = state.tasks.filter(t => t.completed).length;

  DOM.progressRatio.textContent = `${completed} / ${total} tasks complete`;

  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  DOM.progressBarFill.style.width = `${pct}%`;
}

function renderTasksList() {
  DOM.tasksList.innerHTML = '';

  if (state.tasks.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'tasks-empty';
    emptyEl.textContent = 'No tasks due today. Plan ahead or take a break!';
    DOM.tasksList.appendChild(emptyEl);
    return;
  }

  for (const task of state.tasks) {
    const item = createTaskItemElement(task);
    DOM.tasksList.appendChild(item);
  }
}

function createTaskItemElement(task) {
  const item = document.createElement('div');
  item.className = `task-item ${task.completed ? 'is-completed' : ''}`;
  item.dataset.taskId = task.id;

  // Checkbox wrap
  const cbWrap = document.createElement('label');
  cbWrap.className = 'task-checkbox-wrap';
  cbWrap.setAttribute('aria-label', `Mark "${task.title}" complete`);

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'task-checkbox';
  checkbox.checked = task.completed;
  checkbox.addEventListener('change', () => handleToggleTask(task.id, checkbox.checked));
  cbWrap.appendChild(checkbox);

  // Main content
  const main = document.createElement('div');
  main.className = 'task-main';

  const titleEl = document.createElement('div');
  titleEl.className = 'task-title';
  titleEl.textContent = task.title;
  main.appendChild(titleEl);

  const metaEl = document.createElement('div');
  metaEl.className = 'task-meta';

  if (task.subject) {
    const subjEl = document.createElement('span');
    subjEl.className = 'task-subject';

    const dot = document.createElement('span');
    dot.className = 'subject-dot';
    dot.style.backgroundColor = task.subject.color || '#7c3aed';

    const subjName = document.createElement('span');
    subjName.textContent = task.subject.name;

    subjEl.appendChild(dot);
    subjEl.appendChild(subjName);
    metaEl.appendChild(subjEl);
  }

  if (task.priority) {
    const prioEl = document.createElement('span');
    prioEl.className = `task-priority ${task.priority.toLowerCase()}`;
    prioEl.textContent = task.priority;
    metaEl.appendChild(prioEl);
  }

  main.appendChild(metaEl);

  // Delete Action Button
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'task-delete-btn';
  deleteBtn.title = 'Delete task';
  deleteBtn.setAttribute('aria-label', 'Delete task');
  deleteBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    </svg>`;
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleDeleteTask(task.id);
  });

  item.appendChild(cbWrap);
  item.appendChild(main);
  item.appendChild(deleteBtn);

  return item;
}

/* ==========================================================================
   Habits Rendering & Operations
   ========================================================================== */

function renderHabitsList() {
  if (!DOM.habitsList) return;
  DOM.habitsList.innerHTML = '';

  const total = state.habits.length;
  const done = state.habits.filter(h => h.completedToday).length;
  if (DOM.habitsRatio) DOM.habitsRatio.textContent = `${done} / ${total} done`;

  if (total === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'habits-empty';
    emptyEl.textContent = 'No active habits yet.';
    DOM.habitsList.appendChild(emptyEl);
    return;
  }

  for (const habit of state.habits) {
    DOM.habitsList.appendChild(createHabitChip(habit));
  }
}

function createHabitChip(habit) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = `habit-chip ${habit.completedToday ? 'is-done' : ''}`;
  chip.dataset.habitId = habit.id;
  chip.setAttribute('aria-pressed', String(Boolean(habit.completedToday)));
  chip.title = habit.completedToday ? `Mark "${habit.name}" not done` : `Mark "${habit.name}" done`;

  const icon = document.createElement('span');
  icon.className = 'habit-icon';
  icon.textContent = habit.icon || '⚡';
  if (habit.color) icon.style.backgroundColor = habit.color;

  const name = document.createElement('span');
  name.className = 'habit-name';
  name.textContent = habit.name;

  const check = document.createElement('span');
  check.className = 'habit-check';
  check.textContent = habit.completedToday ? '✓' : '';

  chip.appendChild(icon);
  chip.appendChild(name);
  chip.appendChild(check);

  chip.addEventListener('click', () => handleToggleHabit(habit.id));

  return chip;
}

async function handleToggleHabit(habitId) {
  if (!state.isOnline) {
    showStatusBanner('You are offline. Cannot update habits.', 'warning');
    return;
  }

  const habit = state.habits.find(h => h.id === habitId);
  if (!habit) return;

  // Optimistic update
  const previous = habit.completedToday;
  habit.completedToday = !previous;
  renderHabitsList();

  try {
    const result = await api.toggleHabit(habitId, habit.completedToday);
    habit.completedToday = result;
    renderHabitsList();
  } catch (err) {
    console.error('[StudyFlow] Toggle habit failed:', err);
    showStatusBanner('Failed to update habit.', 'error');
    habit.completedToday = previous;
    renderHabitsList();
  }
}

/* ==========================================================================
   Task Operations (CRUD)
   ========================================================================== */

async function handleToggleTask(taskId, isCompleted) {
  if (!state.isOnline) {
    showStatusBanner('You are offline. Cannot update tasks.', 'warning');
    renderTasksList();
    return;
  }

  // Optimistic UI update
  const task = state.tasks.find(t => t.id === taskId);
  if (task) {
    task.completed = isCompleted;
    task.completedAt = isCompleted ? new Date().toISOString() : null;
    renderTasksList();
    renderProgress();
  }

  try {
    await api.completeTask(taskId, isCompleted);
  } catch (err) {
    console.error('[StudyFlow] Toggle task failed:', err);
    showStatusBanner('Failed to update task completion.', 'error');
    // Revert optimistic update
    if (task) {
      task.completed = !isCompleted;
      renderTasksList();
      renderProgress();
    }
  }
}

async function handleDeleteTask(taskId) {
  if (!state.isOnline) {
    showStatusBanner('You are offline. Cannot delete tasks.', 'warning');
    return;
  }

  const prevTasks = [...state.tasks];
  state.tasks = state.tasks.filter(t => t.id !== taskId);
  renderTasksList();
  renderProgress();

  try {
    await api.deleteTask(taskId);
  } catch (err) {
    console.error('[StudyFlow] Delete task failed:', err);
    showStatusBanner('Failed to delete task.', 'error');
    state.tasks = prevTasks;
    renderTasksList();
    renderProgress();
  }
}

async function handleCreateTask(e) {
  e.preventDefault();

  if (!state.isOnline) {
    showQuickAddError('You are offline. Please reconnect to add tasks.');
    return;
  }

  const title = (DOM.newTaskTitle.value || '').trim();
  if (!title) {
    showQuickAddError('Please enter a task title.');
    return;
  }

  const subjectId = DOM.newTaskSubject.value || null;
  const priority = DOM.newTaskPriority.value || 'medium';
  const dueDate = DOM.newTaskDueDate.value || api.getTodayISO();

  hideQuickAddError();
  DOM.saveQuickAddBtn.disabled = true;
  DOM.saveQuickAddBtn.textContent = 'Saving...';

  try {
    const created = await api.createTask({
      title,
      subjectId,
      priority,
      dueDate
    });

    // If task is due today, add it to our active list immediately
    if (created.dueDate === api.getTodayISO()) {
      state.tasks.unshift(created);
      renderTasksList();
      renderProgress();
    }

    // Reset and hide form
    DOM.newTaskTitle.value = '';
    DOM.quickAddForm.classList.add('hidden');
    DOM.toggleQuickAddBtn.setAttribute('aria-expanded', 'false');
  } catch (err) {
    console.error('[StudyFlow] Create task error:', err);
    showQuickAddError(err.message || 'Failed to create task.');
  } finally {
    DOM.saveQuickAddBtn.disabled = false;
    DOM.saveQuickAddBtn.textContent = 'Save Task';
  }
}

function showQuickAddError(msg) {
  DOM.quickAddError.textContent = msg;
  DOM.quickAddError.classList.remove('hidden');
}

function hideQuickAddError() {
  DOM.quickAddError.textContent = '';
  DOM.quickAddError.classList.add('hidden');
}

/* ==========================================================================
   Realtime Subscription
   ========================================================================== */

function setupRealtimeSubscription(userId) {
  if (state.realtimeUnsubscribe) {
    state.realtimeUnsubscribe();
    state.realtimeUnsubscribe = null;
  }

  state.realtimeUnsubscribe = api.subscribeToRealtimeChanges(userId, {
    onTasksChange: (payload) => {
      console.log('[StudyFlow Realtime] Task change received:', payload.eventType);
      // Remote changes arrived; refresh tasks without triggering write loops
      api.getTodayTasks().then(tasks => {
        state.tasks = tasks;
        renderTasksList();
        renderProgress();
      }).catch(err => {
        console.warn('[StudyFlow Realtime] Tasks refresh error:', err);
      });
    },
    onHabitsChange: (payload) => {
      console.log('[StudyFlow Realtime] Habit change received:', payload.eventType);
      api.getTodayHabits().then(habits => {
        state.habits = habits;
        renderHabitsList();
      }).catch(err => {
        console.warn('[StudyFlow Realtime] Habits refresh error:', err);
      });
    },
    onStatusChange: (status) => {
      if (status === 'SUBSCRIBED') {
        updateCloudStatus('connected');
      } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
        updateCloudStatus('syncing');
      } else if (status === 'CLOSED') {
        updateCloudStatus('disconnected');
      }
    }
  });
}

/* ==========================================================================
   Focus Timer (in-panel, timestamp-based, panel-lifecycle-safe)
   --------------------------------------------------------------------------
   State machine logic lives in ../shared/focus-timer.js (pure, tested). This
   controller only wires it to chrome.storage.local (persistence), the DOM
   (rendering), and api.saveStudySession (exactly-once cloud write).
   Only NON-sensitive timer state is persisted — never passwords or tokens.
   ========================================================================== */

async function timerStorageGet(key) {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try {
      const res = await chrome.storage.local.get([key]);
      return res ? res[key] : undefined;
    } catch { return undefined; }
  }
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : undefined;
    } catch { return undefined; }
  }
  return undefined;
}

async function timerStorageSet(key, value) {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try { await chrome.storage.local.set({ [key]: value }); } catch {}
  } else if (typeof localStorage !== 'undefined') {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }
}

async function timerStorageRemove(key) {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try { await chrome.storage.local.remove([key]); } catch {}
  } else if (typeof localStorage !== 'undefined') {
    try { localStorage.removeItem(key); } catch {}
  }
}

/** Loads extension-local Pomodoro durations (seeded from defaults). */
async function loadTimerDurations() {
  const saved = await timerStorageGet(TIMER_SETTINGS_KEY);
  state.timerDurations = ft.normalizeDurations(saved || ft.DEFAULT_DURATIONS);
  syncSettingsInputs();
}

/**
 * Merge in compatible cloud Pomodoro settings (read-only; never overwrites the
 * web app's settings). Extension-local saved values take precedence if present.
 */
function applyCloudTimerDurations() {
  const pomo = state.settings && state.settings.pomodoro;
  if (!pomo) return;
  timerStorageGet(TIMER_SETTINGS_KEY).then((localSaved) => {
    if (localSaved) return; // user has explicit extension prefs; leave them
    state.timerDurations = ft.normalizeDurations({
      focus: pomo.focus,
      shortBreak: pomo.shortBreak,
      longBreak: pomo.longBreak
    });
    syncSettingsInputs();
    if (!state.timer || state.timer.status === 'ready') {
      renderReadyForMode(state.timer ? state.timer.mode : 'focus');
    }
  });
}

function syncSettingsInputs() {
  if (DOM.focusMinFocus) DOM.focusMinFocus.value = state.timerDurations.focus;
  if (DOM.focusMinShort) DOM.focusMinShort.value = state.timerDurations.shortBreak;
  if (DOM.focusMinLong) DOM.focusMinLong.value = state.timerDurations.longBreak;
}

/** Persists only the timer state — contains no credentials. */
async function persistTimer() {
  if (state.timer) {
    await timerStorageSet(TIMER_STORAGE_KEY, state.timer);
  } else {
    await timerStorageRemove(TIMER_STORAGE_KEY);
  }
}

/** Restore a running/paused session belonging to `userId` after panel reopen. */
async function restoreTimerForUser(userId) {
  const saved = await timerStorageGet(TIMER_STORAGE_KEY);

  // Account-switch safety: never adopt another user's timer state.
  if (saved && saved.userId && saved.userId !== userId) {
    await timerStorageRemove(TIMER_STORAGE_KEY);
    state.timer = ft.createReadyState('focus', state.timerDurations, userId);
    renderTimer();
    return;
  }

  if (!saved) {
    state.timer = ft.createReadyState('focus', state.timerDurations, userId);
    renderTimer();
    return;
  }

  state.timer = { ...saved, userId };

  if (ft.isExpired(state.timer)) {
    // Completed while the panel was closed — process exactly once.
    await handleCompletion();
    return;
  }

  if (state.timer.status === 'running') {
    startRenderTick();
  }
  renderTimer();
}

function renderReadyForMode(mode) {
  state.timer = ft.createReadyState(mode, state.timerDurations, state.currentUser ? state.currentUser.id : null);
  renderTimer();
  persistTimer();
}

function startRenderTick() {
  stopRenderTick();
  state.timerInterval = setInterval(() => {
    if (!state.timer || state.timer.status !== 'running') { stopRenderTick(); return; }
    if (ft.isExpired(state.timer)) {
      handleCompletion();
      return;
    }
    updateTimerDisplay();
  }, 500);
}

function stopRenderTick() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

function updateTimerDisplay() {
  if (!DOM.focusTimerDisplay || !state.timer) return;
  DOM.focusTimerDisplay.textContent = ft.formatMMSS(ft.getRemainingMs(state.timer));
}

const STATE_LABELS = { ready: 'READY', running: 'FOCUS', paused: 'PAUSED', completed: 'DONE' };

function renderTimer() {
  const t = state.timer;
  if (!t) return;

  // Break modes show BREAK while running rather than FOCUS.
  let label = STATE_LABELS[t.status] || 'READY';
  if (t.status === 'running' && t.mode !== 'focus') label = 'BREAK';
  if (DOM.focusStateBadge) DOM.focusStateBadge.textContent = label;

  updateTimerDisplay();

  const show = (el, visible) => { if (el) el.classList.toggle('hidden', !visible); };
  const isReady = t.status === 'ready';
  const isRunning = t.status === 'running';
  const isPaused = t.status === 'paused';
  const isCompleted = t.status === 'completed';

  show(DOM.focusStartBtn, isReady);
  show(DOM.focusPauseBtn, isRunning);
  show(DOM.focusResumeBtn, isPaused);
  show(DOM.focusResetBtn, isRunning || isPaused);
  show(DOM.focusBreakBtn, isCompleted);
  show(DOM.focusCompleteMsg, isCompleted);
  show(DOM.focusSelectors, isReady);
  show(DOM.focusSettings, isReady);

  if (isCompleted && DOM.focusStartBtn) {
    // Allow starting a fresh focus block after completion too.
    show(DOM.focusStartBtn, true);
    DOM.focusStartBtn.textContent = '▶ Start Focus';
  } else if (DOM.focusStartBtn) {
    DOM.focusStartBtn.textContent = '▶ Start Focus';
  }
}

function renderFocusSelectors() {
  if (DOM.focusSubjectSelect) {
    DOM.focusSubjectSelect.innerHTML = '<option value="">No subject</option>';
    for (const s of state.subjects) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      DOM.focusSubjectSelect.appendChild(opt);
    }
  }
  if (DOM.focusTaskSelect) {
    DOM.focusTaskSelect.innerHTML = '<option value="">No task</option>';
    for (const t of state.tasks) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.title;
      DOM.focusTaskSelect.appendChild(opt);
    }
  }
}

function handleStartFocus() {
  if (!state.currentUser) return;
  const durationMs = ft.minutesToMs(state.timerDurations.focus);
  const sessionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  state.timer = ft.startTimer(state.timer || ft.createReadyState('focus', state.timerDurations, state.currentUser.id), {
    mode: 'focus',
    durationMs,
    sessionId,
    subjectId: DOM.focusSubjectSelect ? (DOM.focusSubjectSelect.value || null) : null,
    taskId: DOM.focusTaskSelect ? (DOM.focusTaskSelect.value || null) : null,
    userId: state.currentUser.id
  });
  if (DOM.focusSaveNote) DOM.focusSaveNote.classList.add('hidden');
  persistTimer();
  startRenderTick();
  renderTimer();
}

function handleStartBreak() {
  if (!state.timer) return;
  const mode = 'shortBreak';
  const durationMs = ft.minutesToMs(state.timerDurations[mode]);
  // Breaks run locally only and are never written to the cloud.
  state.timer = ft.startTimer(state.timer, {
    mode,
    durationMs,
    sessionId: null,
    userId: state.currentUser ? state.currentUser.id : null
  });
  persistTimer();
  startRenderTick();
  renderTimer();
}

function handlePause() {
  if (!state.timer) return;
  state.timer = ft.pauseTimer(state.timer);
  stopRenderTick();
  persistTimer();
  renderTimer();
}

function handleResume() {
  if (!state.timer) return;
  state.timer = ft.resumeTimer(state.timer);
  persistTimer();
  startRenderTick();
  renderTimer();
}

function handleReset() {
  stopRenderTick();
  const mode = state.timer ? state.timer.mode : 'focus';
  state.timer = ft.resetTimer(
    state.timer || ft.createReadyState('focus', state.timerDurations, state.currentUser ? state.currentUser.id : null),
    state.timerDurations
  );
  if (DOM.focusSaveNote) DOM.focusSaveNote.classList.add('hidden');
  persistTimer();
  renderTimer();
}

/** Processes a completed timer exactly once (write guarded by completionWritten). */
async function handleCompletion() {
  stopRenderTick();
  if (!state.timer) return;

  state.timer = ft.completeTimer(state.timer);
  renderTimer();

  if (!ft.shouldPersistSession(state.timer)) {
    // Break, unauthenticated, or already-written: just persist local state.
    await persistTimer();
    return;
  }

  if (!state.isOnline) {
    // Honest offline messaging: no fake auto-sync queue exists.
    if (DOM.focusSaveNote) {
      DOM.focusSaveNote.textContent = 'Focus complete — session will need to be saved when you\'re online.';
      DOM.focusSaveNote.classList.remove('hidden');
    }
    await persistTimer();
    return;
  }

  try {
    const payload = ft.buildSessionPayload(state.timer);
    await api.saveStudySession(payload);
    // Mark written BEFORE persisting so reopen/reload can never double-write.
    state.timer = ft.markSessionWritten(state.timer);
    if (DOM.focusSaveNote) {
      DOM.focusSaveNote.textContent = 'Saved to your StudyFlow account ✓';
      DOM.focusSaveNote.classList.remove('hidden');
    }
  } catch (err) {
    console.error('[StudyFlow] Focus session save failed:', err);
    if (DOM.focusSaveNote) {
      DOM.focusSaveNote.textContent = 'Focus complete — could not save session (will retry when you start again).';
      DOM.focusSaveNote.classList.remove('hidden');
    }
  } finally {
    await persistTimer();
  }
}

/** Sign-out / account-switch: stop everything and wipe stored timer state. */
function cancelAndClearTimer() {
  stopRenderTick();
  state.timer = null;
  if (DOM.focusSaveNote) DOM.focusSaveNote.classList.add('hidden');
  timerStorageRemove(TIMER_STORAGE_KEY);
}

async function handleSaveTimerSettings() {
  const parse = (el, def, min, max) => {
    const n = Math.round(Number(el && el.value));
    if (!Number.isFinite(n) || n < min || n > max) return def;
    return n;
  };
  state.timerDurations = ft.normalizeDurations({
    focus: parse(DOM.focusMinFocus, state.timerDurations.focus, 1, 180),
    shortBreak: parse(DOM.focusMinShort, state.timerDurations.shortBreak, 1, 60),
    longBreak: parse(DOM.focusMinLong, state.timerDurations.longBreak, 1, 120)
  });
  await timerStorageSet(TIMER_SETTINGS_KEY, state.timerDurations);
  syncSettingsInputs();
  if (state.timer && state.timer.status === 'ready') {
    renderReadyForMode(state.timer.mode);
  }
}

function initFocusTimerListeners() {
  if (DOM.focusStartBtn) DOM.focusStartBtn.addEventListener('click', handleStartFocus);
  if (DOM.focusPauseBtn) DOM.focusPauseBtn.addEventListener('click', handlePause);
  if (DOM.focusResumeBtn) DOM.focusResumeBtn.addEventListener('click', handleResume);
  if (DOM.focusResetBtn) DOM.focusResetBtn.addEventListener('click', handleReset);
  if (DOM.focusBreakBtn) DOM.focusBreakBtn.addEventListener('click', handleStartBreak);
  if (DOM.focusSaveSettingsBtn) DOM.focusSaveSettingsBtn.addEventListener('click', handleSaveTimerSettings);
}

/* ==========================================================================
   Event Bindings
   ========================================================================== */

function initEventListeners() {
  // Theme toggle
  DOM.themeToggleBtn.addEventListener('click', toggleTheme);

  // Auth actions
  DOM.authActionBtn.addEventListener('click', async () => {
    if (state.currentUser) {
      if (confirm('Are you sure you want to sign out of StudyFlow?')) {
        await auth.signOut();
        setUnauthenticatedState();
      }
    } else {
      setUnauthenticatedState();
    }
  });

  // Sign In Form submission
  DOM.signInForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = DOM.authEmail.value.trim();
    const password = DOM.authPassword.value;

    DOM.authErrorMsg.classList.add('hidden');
    DOM.authErrorMsg.textContent = '';
    DOM.signInSubmitBtn.disabled = true;

    const spinner = DOM.signInSubmitBtn.querySelector('.btn-spinner');
    const btnText = DOM.signInSubmitBtn.querySelector('.btn-text');
    if (spinner) spinner.classList.remove('hidden');
    if (btnText) btnText.textContent = 'Signing in...';

    try {
      await auth.signIn(email, password);
      // auth.onAuthStateChange will automatically switch to authenticated view
    } catch (err) {
      DOM.authErrorMsg.textContent = err.message || 'Sign in failed.';
      DOM.authErrorMsg.classList.remove('hidden');
    } finally {
      DOM.signInSubmitBtn.disabled = false;
      if (spinner) spinner.classList.add('hidden');
      if (btnText) btnText.textContent = 'Sign In';
    }
  });

  // Quick Add Toggle & Form
  DOM.toggleQuickAddBtn.addEventListener('click', () => {
    const isHidden = DOM.quickAddForm.classList.contains('hidden');
    if (isHidden) {
      DOM.quickAddForm.classList.remove('hidden');
      DOM.toggleQuickAddBtn.setAttribute('aria-expanded', 'true');
      DOM.newTaskTitle.focus();
    } else {
      DOM.quickAddForm.classList.add('hidden');
      DOM.toggleQuickAddBtn.setAttribute('aria-expanded', 'false');
      hideQuickAddError();
    }
  });

  DOM.cancelQuickAddBtn.addEventListener('click', () => {
    DOM.quickAddForm.classList.add('hidden');
    DOM.toggleQuickAddBtn.setAttribute('aria-expanded', 'false');
    hideQuickAddError();
  });

  DOM.quickAddForm.addEventListener('submit', handleCreateTask);
}
