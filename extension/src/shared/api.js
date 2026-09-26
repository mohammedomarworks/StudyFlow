/* ==========================================================================
   api.js — Cloud Data API Layer for StudyFlow Extension
   --------------------------------------------------------------------------
   Encapsulates all Supabase database queries and mutations.
   Guarantees that user_id is always derived from the authenticated session
   and never supplied or overridden by arbitrary UI input.
   ========================================================================== */

import { getSupabaseClient } from './supabase.js';
import { getUser } from './auth.js';

/**
 * Helper to get the local date ISO string ('YYYY-MM-DD').
 */
export function getTodayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Normalizes database task row to application task model.
 */
function fromDbTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    subjectId: row.subject_id || '',
    title: row.title || 'Untitled Task',
    notes: row.notes || '',
    category: row.category || 'General',
    priority: row.priority || 'medium',
    dueDate: row.due_date || '',
    estimate: Number(row.estimate_minutes) || 0,
    completed: Boolean(row.completed),
    completedAt: row.completed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    subject: row.subjects ? {
      id: row.subjects.id,
      name: row.subjects.name,
      color: row.subjects.color || '#7c3aed'
    } : null
  };
}

/**
 * Normalizes database subject row.
 */
function fromDbSubject(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name || 'Untitled Subject',
    code: row.code || '',
    teacher: row.teacher || '',
    color: row.color || '#7c3aed',
    examDate: row.exam_date || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at
  };
}

/**
 * 1. Retrieves the current authenticated user.
 */
export async function getCurrentUser() {
  return await getUser();
}

/**
 * Asserts the user is authenticated and returns the user object.
 */
async function requireUser() {
  const user = await getCurrentUser();
  if (!user || !user.id) {
    throw new Error('You must be signed in to perform this operation.');
  }
  return user;
}

/**
 * 2. Retrieves today's tasks for the active user.
 */
export async function getTodayTasks() {
  const user = await requireUser();
  const client = getSupabaseClient();
  const today = getTodayISO();

  const { data, error } = await client
    .from('tasks')
    .select('*, subjects(id, name, color)')
    .eq('user_id', user.id)
    .eq('due_date', today)
    .order('completed', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[StudyFlow API] getTodayTasks error:', error);
    throw new Error(`Failed to load tasks: ${error.message}`);
  }

  return (data || []).map(fromDbTask);
}

/**
 * Retrieves all subjects for dropdowns and display.
 */
export async function getSubjects() {
  const user = await requireUser();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('subjects')
    .select('*')
    .eq('user_id', user.id)
    .order('name', { ascending: true });

  if (error) {
    console.error('[StudyFlow API] getSubjects error:', error);
    throw new Error(`Failed to load subjects: ${error.message}`);
  }

  return (data || []).map(fromDbSubject);
}

/**
 * 3. Creates a new task.
 */
export async function createTask(taskData) {
  const user = await requireUser();
  const client = getSupabaseClient();

  const title = (taskData?.title || '').trim();
  if (!title) {
    throw new Error('Task title cannot be empty.');
  }

  const payload = {
    user_id: user.id,
    title,
    subject_id: (taskData.subjectId && taskData.subjectId.trim()) ? taskData.subjectId.trim() : null,
    due_date: (taskData.dueDate && taskData.dueDate.trim()) ? taskData.dueDate.trim() : getTodayISO(),
    priority: ['low', 'medium', 'high'].includes(taskData.priority) ? taskData.priority : 'medium',
    category: taskData.category || 'General',
    estimate_minutes: Number(taskData.estimate) || 0,
    notes: taskData.notes || null,
    completed: false
  };

  const { data, error } = await client
    .from('tasks')
    .insert(payload)
    .select('*, subjects(id, name, color)')
    .single();

  if (error) {
    console.error('[StudyFlow API] createTask error:', error);
    throw new Error(`Failed to create task: ${error.message}`);
  }

  return fromDbTask(data);
}

/**
 * 4. Updates an existing task.
 */
export async function updateTask(id, updates = {}) {
  const user = await requireUser();
  if (!id) throw new Error('Task ID is required for update.');
  const client = getSupabaseClient();

  const dbUpdates = {
    updated_at: new Date().toISOString()
  };

  if (updates.title !== undefined) dbUpdates.title = updates.title.trim();
  if (updates.subjectId !== undefined) dbUpdates.subject_id = updates.subjectId || null;
  if (updates.dueDate !== undefined) dbUpdates.due_date = updates.dueDate || null;
  if (updates.priority !== undefined) dbUpdates.priority = updates.priority;
  if (updates.category !== undefined) dbUpdates.category = updates.category;
  if (updates.estimate !== undefined) dbUpdates.estimate_minutes = Number(updates.estimate) || 0;
  if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
  if (updates.completed !== undefined) {
    dbUpdates.completed = Boolean(updates.completed);
    dbUpdates.completed_at = updates.completed ? new Date().toISOString() : null;
  }

  const { data, error } = await client
    .from('tasks')
    .update(dbUpdates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*, subjects(id, name, color)')
    .single();

  if (error) {
    console.error('[StudyFlow API] updateTask error:', error);
    throw new Error(`Failed to update task: ${error.message}`);
  }

  return fromDbTask(data);
}

/**
 * 5. Toggles or sets task completion state.
 */
export async function completeTask(id, completed) {
  const user = await requireUser();
  if (!id) throw new Error('Task ID is required.');
  const client = getSupabaseClient();

  const isCompleted = Boolean(completed);
  const { data, error } = await client
    .from('tasks')
    .update({
      completed: isCompleted,
      completed_at: isCompleted ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*, subjects(id, name, color)')
    .single();

  if (error) {
    console.error('[StudyFlow API] completeTask error:', error);
    throw new Error(`Failed to update task completion: ${error.message}`);
  }

  return fromDbTask(data);
}

/**
 * 6. Deletes a task.
 */
export async function deleteTask(id) {
  const user = await requireUser();
  if (!id) throw new Error('Task ID is required for deletion.');
  const client = getSupabaseClient();

  const { error } = await client
    .from('tasks')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    console.error('[StudyFlow API] deleteTask error:', error);
    throw new Error(`Failed to delete task: ${error.message}`);
  }

  return true;
}

/**
 * 7. Retrieves today's active habits and completion statuses.
 */
export async function getTodayHabits() {
  const user = await requireUser();
  const client = getSupabaseClient();
  const today = getTodayISO();

  const [habitsRes, completionsRes] = await Promise.all([
    client
      .from('habits')
      .select('*, subjects(id, name, color)')
      .eq('user_id', user.id)
      .eq('archived', false)
      .order('created_at', { ascending: true }),
    client
      .from('habit_completions')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', today)
  ]);

  if (habitsRes.error) {
    throw new Error(`Failed to load habits: ${habitsRes.error.message}`);
  }

  const completedHabitIds = new Set(
    (completionsRes.data || []).map(c => c.habit_id)
  );

  return (habitsRes.data || []).map(h => ({
    id: h.id,
    name: h.name,
    icon: h.icon || '⚡',
    color: h.color || '#7c3aed',
    completedToday: completedHabitIds.has(h.id),
    subject: h.subjects ? {
      id: h.subjects.id,
      name: h.subjects.name,
      color: h.subjects.color
    } : null
  }));
}

/**
 * Toggles a habit's completion for today by inserting or removing a
 * habit_completions row. Mirrors the web app's semantics exactly: streaks
 * are derived dynamically, so no counters are stored here.
 * Returns the resulting completed state (true = completed).
 */
export async function toggleHabit(habitId, completed) {
  const user = await requireUser();
  if (!habitId) throw new Error('Habit ID is required.');
  const client = getSupabaseClient();
  const today = getTodayISO();

  const { data: existing, error: checkErr } = await client
    .from('habit_completions')
    .select('id')
    .eq('user_id', user.id)
    .eq('habit_id', habitId)
    .eq('date', today)
    .maybeSingle();

  if (checkErr) {
    console.error('[StudyFlow API] toggleHabit check error:', checkErr);
    throw new Error(`Failed to update habit: ${checkErr.message}`);
  }

  const shouldComplete = completed === undefined ? !existing : Boolean(completed);

  if (shouldComplete && !existing) {
    const { error: insErr } = await client
      .from('habit_completions')
      .insert({
        user_id: user.id,
        habit_id: habitId,
        date: today,
        completed_at: new Date().toISOString()
      });
    if (insErr) throw new Error(`Failed to complete habit: ${insErr.message}`);
    return true;
  }

  if (!shouldComplete && existing) {
    const { error: delErr } = await client
      .from('habit_completions')
      .delete()
      .eq('id', existing.id)
      .eq('user_id', user.id);
    if (delErr) throw new Error(`Failed to update habit: ${delErr.message}`);
    return false;
  }

  return shouldComplete;
}

/**
 * 8. Retrieves user settings from cloud.
 */
export async function getSettings() {
  const user = await requireUser();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('settings')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.warn('[StudyFlow API] getSettings warning:', error);
  }

  if (data) {
    return {
      theme: data.theme || 'system',
      pomodoro: data.pomodoro || { focus: 25, dailyGoal: 120 },
      preferences: data.preferences || {}
    };
  }

  return {
    theme: 'system',
    pomodoro: { focus: 25, shortBreak: 5, longBreak: 15, dailyGoal: 120 },
    preferences: { confirmDelete: true }
  };
}

/**
 * Persists a completed focus session to the cloud `study_sessions` table.
 *
 * IDEMPOTENCY: the caller supplies a client-generated UUID `id`. We upsert with
 * `onConflict: 'id'`, so re-running the same completion (panel reopen, reload,
 * realtime echo) can never create a duplicate row — it matches the web app's
 * `Store.saveSession` / repository `_toDbSession` conventions exactly.
 *
 * `user_id` is always taken from the authenticated session, never from input.
 * Only fields that exist in the schema are written; nothing is fabricated.
 */
export async function saveStudySession(sessionData) {
  const user = await requireUser();
  const client = getSupabaseClient();

  if (!sessionData || !sessionData.id || typeof sessionData.id !== 'string') {
    throw new Error('A client-generated session id (UUID) is required for idempotent save.');
  }

  const payload = {
    id: sessionData.id,
    user_id: user.id,
    type: sessionData.type === 'break' ? 'break' : 'focus',
    duration_minutes: Math.max(1, Number(sessionData.durationMinutes) || 25),
    subject_id: (sessionData.subjectId && typeof sessionData.subjectId === 'string' && sessionData.subjectId.trim())
      ? sessionData.subjectId.trim()
      : null,
    task_id: (sessionData.taskId && typeof sessionData.taskId === 'string' && sessionData.taskId.trim())
      ? sessionData.taskId.trim()
      : null,
    completed_at: sessionData.completedAt || new Date().toISOString()
  };

  const { data, error } = await client
    .from('study_sessions')
    .upsert(payload, { onConflict: 'id' })
    .select('id')
    .single();

  if (error) {
    console.error('[StudyFlow API] saveStudySession error:', error);
    throw new Error(`Failed to save focus session: ${error.message}`);
  }

  return data;
}

/**
 * Creates minimal Realtime subscription for tasks and habits.
 */
export function subscribeToRealtimeChanges(userId, { onTasksChange, onHabitsChange, onStatusChange }) {
  if (!userId) return () => {};
  const client = getSupabaseClient();

  const channel = client.channel(`studyflow_ext_${userId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'tasks',
      filter: `user_id=eq.${userId}`
    }, (payload) => {
      if (typeof onTasksChange === 'function') {
        onTasksChange(payload);
      }
    })
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'habits',
      filter: `user_id=eq.${userId}`
    }, (payload) => {
      if (typeof onHabitsChange === 'function') {
        onHabitsChange(payload);
      }
    })
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'habit_completions',
      filter: `user_id=eq.${userId}`
    }, (payload) => {
      if (typeof onHabitsChange === 'function') {
        onHabitsChange(payload);
      }
    })
    .subscribe((status) => {
      if (typeof onStatusChange === 'function') {
        onStatusChange(status);
      }
    });

  return () => {
    client.removeChannel(channel);
  };
}

export default {
  getTodayISO,
  getCurrentUser,
  getTodayTasks,
  getSubjects,
  createTask,
  updateTask,
  completeTask,
  deleteTask,
  getTodayHabits,
  toggleHabit,
  getSettings,
  saveStudySession,
  subscribeToRealtimeChanges
};
