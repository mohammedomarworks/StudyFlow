-- ============================================================================
-- StudyFlow v2.0 — Phase A: Initial Supabase Schema Migration
-- Migration: 0001_initial_schema.sql
-- Description: Creates the 9 core tables, foreign keys with safe deletion
--              behavior, performance indexes, triggers for new user profiles,
--              Row Level Security (RLS) policies, and foreign-key ownership guards.
-- ============================================================================

-- Ensure pgcrypto or gen_random_uuid() is available
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. PROFILES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. SUBJECTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text,
  teacher text,
  color text NOT NULL DEFAULT '#7c3aed',
  exam_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subjects_user_id ON public.subjects(user_id);

-- ============================================================================
-- 3. TASKS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  title text NOT NULL,
  notes text,
  category text NOT NULL DEFAULT 'General',
  priority text NOT NULL DEFAULT 'medium',
  due_date date,
  estimate_minutes integer NOT NULL DEFAULT 0,
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON public.tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_id_due_date ON public.tasks(user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_user_id_completed ON public.tasks(user_id, completed);
CREATE INDEX IF NOT EXISTS idx_tasks_subject_id ON public.tasks(subject_id);

-- ============================================================================
-- 4. NOTES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'Untitled Note',
  content text NOT NULL DEFAULT '',
  tags text[] DEFAULT '{}'::text[],
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notes_user_id ON public.notes(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_subject_id ON public.notes(subject_id);
CREATE INDEX IF NOT EXISTS idx_notes_user_id_updated_at ON public.notes(user_id, updated_at);

-- ============================================================================
-- 5. HABITS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.habits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  icon text NOT NULL DEFAULT '⚡',
  color text NOT NULL DEFAULT '#7c3aed',
  frequency text NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily', 'weekdays')),
  target_days jsonb NOT NULL DEFAULT '[0, 1, 2, 3, 4, 5, 6]'::jsonb,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_habits_user_id ON public.habits(user_id);
CREATE INDEX IF NOT EXISTS idx_habits_subject_id ON public.habits(subject_id);
CREATE INDEX IF NOT EXISTS idx_habits_user_id_archived ON public.habits(user_id, archived);

-- ============================================================================
-- 6. HABIT COMPLETIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.habit_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  habit_id uuid NOT NULL REFERENCES public.habits(id) ON DELETE CASCADE,
  date date NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_habit_completion_habit_date UNIQUE(habit_id, date)
);

CREATE INDEX IF NOT EXISTS idx_habit_completions_user_id ON public.habit_completions(user_id);
CREATE INDEX IF NOT EXISTS idx_habit_completions_habit_id ON public.habit_completions(habit_id);
CREATE INDEX IF NOT EXISTS idx_habit_completions_user_id_date ON public.habit_completions(user_id, date);

-- ============================================================================
-- 7. STUDY SESSIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.study_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  type text NOT NULL DEFAULT 'focus',
  duration_minutes integer NOT NULL DEFAULT 25,
  notes text,
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_study_sessions_user_id ON public.study_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_study_sessions_user_id_completed_at ON public.study_sessions(user_id, completed_at);
CREATE INDEX IF NOT EXISTS idx_study_sessions_subject_id ON public.study_sessions(subject_id);
CREATE INDEX IF NOT EXISTS idx_study_sessions_task_id ON public.study_sessions(task_id);

-- ============================================================================
-- 8. ACTIVITY
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  text text NOT NULL,
  meta jsonb,
  timestamp timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_user_id ON public.activity(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_user_id_timestamp ON public.activity(user_id, timestamp);

-- ============================================================================
-- 9. SETTINGS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  theme text NOT NULL DEFAULT 'system',
  pomodoro jsonb NOT NULL DEFAULT '{"focus": 25, "shortBreak": 5, "longBreak": 15, "sound": true, "autoBreak": false, "dailyGoal": 120}'::jsonb,
  preferences jsonb NOT NULL DEFAULT '{"confirmDelete": true, "defaultTaskSort": "due-asc", "motion": "system"}'::jsonb,
  last_export_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- TRIGGERS: UPDATED_AT TIMESTAMP MAINTENANCE
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_profiles_updated_at ON public.profiles;
CREATE TRIGGER tr_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_subjects_updated_at ON public.subjects;
CREATE TRIGGER tr_subjects_updated_at
  BEFORE UPDATE ON public.subjects
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_tasks_updated_at ON public.tasks;
CREATE TRIGGER tr_tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_notes_updated_at ON public.notes;
CREATE TRIGGER tr_notes_updated_at
  BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_habits_updated_at ON public.habits;
CREATE TRIGGER tr_habits_updated_at
  BEFORE UPDATE ON public.habits
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_settings_updated_at ON public.settings;
CREATE TRIGGER tr_settings_updated_at
  BEFORE UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================================
-- TRIGGERS: FOREIGN KEY OWNERSHIP INTEGRITY (DEFENSE-IN-DEPTH)
-- Prevents referencing another user's subject, task, or habit
-- ============================================================================
CREATE OR REPLACE FUNCTION public.check_entity_ownership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Tasks, Notes, Habits: subject_id must belong to NEW.user_id if set
  IF TG_TABLE_NAME IN ('tasks', 'notes', 'habits') THEN
    IF NEW.subject_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.subjects WHERE id = NEW.subject_id AND user_id = NEW.user_id) THEN
        RAISE EXCEPTION 'Cross-user violation: Referenced subject does not belong to the user.';
      END IF;
    END IF;
  -- Habit Completions: habit_id must belong to NEW.user_id
  ELSIF TG_TABLE_NAME = 'habit_completions' THEN
    IF NEW.habit_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.habits WHERE id = NEW.habit_id AND user_id = NEW.user_id) THEN
        RAISE EXCEPTION 'Cross-user violation: Referenced habit does not belong to the user.';
      END IF;
    END IF;
  -- Study Sessions: subject_id and task_id must belong to NEW.user_id if set
  ELSIF TG_TABLE_NAME = 'study_sessions' THEN
    IF NEW.subject_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.subjects WHERE id = NEW.subject_id AND user_id = NEW.user_id) THEN
        RAISE EXCEPTION 'Cross-user violation: Referenced subject does not belong to the user.';
      END IF;
    END IF;
    IF NEW.task_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.tasks WHERE id = NEW.task_id AND user_id = NEW.user_id) THEN
        RAISE EXCEPTION 'Cross-user violation: Referenced task does not belong to the user.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_tasks_ownership ON public.tasks;
CREATE TRIGGER tr_tasks_ownership
  BEFORE INSERT OR UPDATE OF subject_id, user_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.check_entity_ownership();

DROP TRIGGER IF EXISTS tr_notes_ownership ON public.notes;
CREATE TRIGGER tr_notes_ownership
  BEFORE INSERT OR UPDATE OF subject_id, user_id ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.check_entity_ownership();

DROP TRIGGER IF EXISTS tr_habits_ownership ON public.habits;
CREATE TRIGGER tr_habits_ownership
  BEFORE INSERT OR UPDATE OF subject_id, user_id ON public.habits
  FOR EACH ROW EXECUTE FUNCTION public.check_entity_ownership();

DROP TRIGGER IF EXISTS tr_habit_completions_ownership ON public.habit_completions;
CREATE TRIGGER tr_habit_completions_ownership
  BEFORE INSERT OR UPDATE OF habit_id, user_id ON public.habit_completions
  FOR EACH ROW EXECUTE FUNCTION public.check_entity_ownership();

DROP TRIGGER IF EXISTS tr_study_sessions_ownership ON public.study_sessions;
CREATE TRIGGER tr_study_sessions_ownership
  BEFORE INSERT OR UPDATE OF subject_id, task_id, user_id ON public.study_sessions
  FOR EACH ROW EXECUTE FUNCTION public.check_entity_ownership();

-- ============================================================================
-- AUTH TRIGGER: NEW USER INITIALIZATION
-- Automatically provisions profiles and settings rows upon auth.users INSERT
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      NEW.raw_user_meta_data->>'full_name',
      split_part(NEW.email, '@', 1),
      'Student'
    ),
    NEW.raw_user_meta_data->>'avatar_url'
  );

  INSERT INTO public.settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Mandatory on every user-owned table. Unauthenticated access denied by default.
-- Every policy explicitly targets `TO authenticated` and verifies `auth.uid() = user_id`.
-- ============================================================================

-- Enable RLS across all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.habits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.habit_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- PROFILES POLICIES
-- ----------------------------------------------------------------------------
CREATE POLICY "profiles_select_authenticated" ON public.profiles
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = id);

CREATE POLICY "profiles_insert_authenticated" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = id);

CREATE POLICY "profiles_update_authenticated" ON public.profiles
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);

CREATE POLICY "profiles_delete_authenticated" ON public.profiles
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = id);

-- ----------------------------------------------------------------------------
-- SETTINGS POLICIES
-- ----------------------------------------------------------------------------
CREATE POLICY "settings_select_authenticated" ON public.settings
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "settings_insert_authenticated" ON public.settings
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "settings_update_authenticated" ON public.settings
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "settings_delete_authenticated" ON public.settings
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- SUBJECTS POLICIES
-- ----------------------------------------------------------------------------
CREATE POLICY "subjects_select_authenticated" ON public.subjects
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "subjects_insert_authenticated" ON public.subjects
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "subjects_update_authenticated" ON public.subjects
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "subjects_delete_authenticated" ON public.subjects
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- TASKS POLICIES
-- RLS WITH CHECK ensures tasks.subject_id belongs to the same user
-- ----------------------------------------------------------------------------
CREATE POLICY "tasks_select_authenticated" ON public.tasks
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "tasks_insert_authenticated" ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (
      subject_id IS NULL OR EXISTS (
        SELECT 1 FROM public.subjects WHERE subjects.id = tasks.subject_id AND subjects.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "tasks_update_authenticated" ON public.tasks
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (
      subject_id IS NULL OR EXISTS (
        SELECT 1 FROM public.subjects WHERE subjects.id = tasks.subject_id AND subjects.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "tasks_delete_authenticated" ON public.tasks
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- NOTES POLICIES
-- RLS WITH CHECK ensures notes.subject_id belongs to the same user
-- ----------------------------------------------------------------------------
CREATE POLICY "notes_select_authenticated" ON public.notes
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "notes_insert_authenticated" ON public.notes
  FOR INSERT TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (
      subject_id IS NULL OR EXISTS (
        SELECT 1 FROM public.subjects WHERE subjects.id = notes.subject_id AND subjects.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "notes_update_authenticated" ON public.notes
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (
      subject_id IS NULL OR EXISTS (
        SELECT 1 FROM public.subjects WHERE subjects.id = notes.subject_id AND subjects.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "notes_delete_authenticated" ON public.notes
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- HABITS POLICIES
-- RLS WITH CHECK ensures habits.subject_id belongs to the same user
-- ----------------------------------------------------------------------------
CREATE POLICY "habits_select_authenticated" ON public.habits
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "habits_insert_authenticated" ON public.habits
  FOR INSERT TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (
      subject_id IS NULL OR EXISTS (
        SELECT 1 FROM public.subjects WHERE subjects.id = habits.subject_id AND subjects.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "habits_update_authenticated" ON public.habits
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (
      subject_id IS NULL OR EXISTS (
        SELECT 1 FROM public.subjects WHERE subjects.id = habits.subject_id AND subjects.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "habits_delete_authenticated" ON public.habits
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- HABIT COMPLETIONS POLICIES
-- RLS WITH CHECK ensures habit_completions.habit_id belongs to the same user
-- ----------------------------------------------------------------------------
CREATE POLICY "habit_completions_select_authenticated" ON public.habit_completions
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "habit_completions_insert_authenticated" ON public.habit_completions
  FOR INSERT TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.habits WHERE habits.id = habit_completions.habit_id AND habits.user_id = auth.uid()
    )
  );

CREATE POLICY "habit_completions_update_authenticated" ON public.habit_completions
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK (
    (select auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.habits WHERE habits.id = habit_completions.habit_id AND habits.user_id = auth.uid()
    )
  );

CREATE POLICY "habit_completions_delete_authenticated" ON public.habit_completions
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- STUDY SESSIONS POLICIES
-- RLS WITH CHECK ensures subject_id and task_id belong to the same user
-- ----------------------------------------------------------------------------
CREATE POLICY "study_sessions_select_authenticated" ON public.study_sessions
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "study_sessions_insert_authenticated" ON public.study_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (
      subject_id IS NULL OR EXISTS (
        SELECT 1 FROM public.subjects WHERE subjects.id = study_sessions.subject_id AND subjects.user_id = auth.uid()
      )
    )
    AND (
      task_id IS NULL OR EXISTS (
        SELECT 1 FROM public.tasks WHERE tasks.id = study_sessions.task_id AND tasks.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "study_sessions_update_authenticated" ON public.study_sessions
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (
      subject_id IS NULL OR EXISTS (
        SELECT 1 FROM public.subjects WHERE subjects.id = study_sessions.subject_id AND subjects.user_id = auth.uid()
      )
    )
    AND (
      task_id IS NULL OR EXISTS (
        SELECT 1 FROM public.tasks WHERE tasks.id = study_sessions.task_id AND tasks.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "study_sessions_delete_authenticated" ON public.study_sessions
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- ACTIVITY POLICIES
-- ----------------------------------------------------------------------------
CREATE POLICY "activity_select_authenticated" ON public.activity
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "activity_insert_authenticated" ON public.activity
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "activity_update_authenticated" ON public.activity
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "activity_delete_authenticated" ON public.activity
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);
