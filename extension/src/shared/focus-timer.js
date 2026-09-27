/* ==========================================================================
   focus-timer.js — Pure Focus Timer State Logic (StudyFlow v2.1.0)
   --------------------------------------------------------------------------
   Framework-free, side-effect-free timer state machine. Contains NO chrome,
   DOM, network, or Date.now() side effects baked in (callers pass `now`),
   so the logic is fully unit-testable in plain Node.

   Countdown is TIMESTAMP-BASED: remaining time is always derived from an
   absolute `endTime`, never by decrementing a counter. This keeps the timer
   accurate across Side Panel suspension / close / reopen.
   ========================================================================== */

export const DEFAULT_DURATIONS = Object.freeze({
  focus: 25,
  shortBreak: 5,
  longBreak: 15
});

export const MODES = Object.freeze(['focus', 'shortBreak', 'longBreak']);

export function minutesToMs(minutes) {
  return Math.round(Number(minutes) * 60000);
}

/**
 * Merges partial/cloud durations with the safe defaults.
 */
export function normalizeDurations(durations) {
  const d = durations || {};
  return {
    focus: Number(d.focus) > 0 ? Number(d.focus) : DEFAULT_DURATIONS.focus,
    shortBreak: Number(d.shortBreak) > 0 ? Number(d.shortBreak) : DEFAULT_DURATIONS.shortBreak,
    longBreak: Number(d.longBreak) > 0 ? Number(d.longBreak) : DEFAULT_DURATIONS.longBreak
  };
}

/**
 * Creates a fresh READY state for the given mode.
 */
export function createReadyState(mode = 'focus', durations = DEFAULT_DURATIONS, userId = null) {
  const safeMode = MODES.includes(mode) ? mode : 'focus';
  const norm = normalizeDurations(durations);
  const durationMs = minutesToMs(norm[safeMode]);
  return {
    status: 'ready',
    mode: safeMode,
    durationMs,
    endTime: null,
    remainingMs: durationMs,
    sessionId: null,
    subjectId: null,
    taskId: null,
    completionWritten: false,
    userId: userId || null
  };
}

/**
 * Starts (or restarts) the timer running from `now`.
 * opts: { mode, durationMs, sessionId, subjectId, taskId, userId }
 */
export function startTimer(state, opts = {}, now = Date.now()) {
  const mode = opts.mode || state.mode || 'focus';
  const durationMs = opts.durationMs != null ? opts.durationMs : state.durationMs;
  return {
    ...state,
    status: 'running',
    mode,
    durationMs,
    endTime: now + durationMs,
    remainingMs: durationMs,
    sessionId: opts.sessionId != null ? opts.sessionId : state.sessionId,
    subjectId: opts.subjectId !== undefined ? opts.subjectId : state.subjectId,
    taskId: opts.taskId !== undefined ? opts.taskId : state.taskId,
    completionWritten: false,
    userId: opts.userId !== undefined ? opts.userId : state.userId
  };
}

/**
 * Pauses a running timer, freezing the remaining time.
 */
export function pauseTimer(state, now = Date.now()) {
  if (state.status !== 'running') return state;
  const remainingMs = Math.max(0, state.endTime - now);
  return { ...state, status: 'paused', endTime: null, remainingMs };
}

/**
 * Resumes a paused timer by projecting a new endTime from the remaining time.
 */
export function resumeTimer(state, now = Date.now()) {
  if (state.status !== 'paused') return state;
  return { ...state, status: 'running', endTime: now + state.remainingMs };
}

/**
 * Resets to a READY state for the current mode. Clears the session id so a new
 * run produces a new completion identity. Preserves subject/task selection.
 */
export function resetTimer(state, durations = DEFAULT_DURATIONS) {
  const norm = normalizeDurations(durations);
  const durationMs = minutesToMs(norm[state.mode] || DEFAULT_DURATIONS[state.mode]);
  return {
    status: 'ready',
    mode: state.mode,
    durationMs,
    endTime: null,
    remainingMs: durationMs,
    sessionId: null,
    subjectId: state.subjectId,
    taskId: state.taskId,
    completionWritten: false,
    userId: state.userId
  };
}

/**
 * Remaining milliseconds, always derived from timestamps when running.
 */
export function getRemainingMs(state, now = Date.now()) {
  if (!state) return 0;
  if (state.status === 'running') return Math.max(0, state.endTime - now);
  if (state.status === 'completed') return 0;
  return Math.max(0, state.remainingMs);
}

/**
 * True when a running timer has reached (or passed) its end.
 */
export function isExpired(state, now = Date.now()) {
  return state && state.status === 'running' && (state.endTime - now) <= 0;
}

/**
 * Transitions to COMPLETED. Idempotent — completing an already-completed
 * state leaves it unchanged.
 */
export function completeTimer(state) {
  if (state.status === 'completed') return state;
  return { ...state, status: 'completed', endTime: null, remainingMs: 0 };
}

/**
 * Whether a completed FOCUS session should be persisted to the cloud exactly
 * once. Breaks are never written; requires an authenticated user + session id
 * and that no write has yet been recorded.
 */
export function shouldPersistSession(state) {
  return Boolean(
    state &&
    state.status === 'completed' &&
    state.mode === 'focus' &&
    state.completionWritten === false &&
    state.userId &&
    state.sessionId
  );
}

/**
 * Marks the completion write as done (dedupe guard).
 */
export function markSessionWritten(state) {
  return { ...state, completionWritten: true };
}

/**
 * Builds the study_sessions payload matching the web app's schema/semantics.
 * The client-generated `id` enables idempotent upsert (exactly-once).
 */
export function buildSessionPayload(state) {
  return {
    id: state.sessionId,
    type: 'focus',
    durationMinutes: Math.max(1, Math.round(state.durationMs / 60000)),
    subjectId: state.subjectId || null,
    taskId: state.taskId || null,
    completedAt: new Date().toISOString()
  };
}

/**
 * Formats milliseconds as MM:SS (rounds up so a full duration shows e.g. 25:00).
 */
export function formatMMSS(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const m = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const s = String(totalSeconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export default {
  DEFAULT_DURATIONS,
  MODES,
  minutesToMs,
  normalizeDurations,
  createReadyState,
  startTimer,
  pauseTimer,
  resumeTimer,
  resetTimer,
  getRemainingMs,
  isExpired,
  completeTimer,
  shouldPersistSession,
  markSessionWritten,
  buildSessionPayload,
  formatMMSS
};
