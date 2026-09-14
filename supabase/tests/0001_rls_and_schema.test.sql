-- ============================================================================
-- StudyFlow v2.0 — Phase A: Database & RLS Tests (pgTAP)
-- Test File: supabase/tests/0001_rls_and_schema.test.sql
-- Run with: supabase test db
-- ============================================================================

BEGIN;

-- Load pgTAP extension
CREATE EXTENSION IF NOT EXISTS pgtap;

-- Plan 14 assertions across the 8 test scenarios
SELECT plan(14);

-- ----------------------------------------------------------------------------
-- Setup Mock Users in auth.users
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  uid1 uuid := '11111111-1111-1111-1111-111111111111';
  uid2 uuid := '22222222-2222-2222-2222-222222222222';
BEGIN
  -- Insert User 1 into auth.users (triggers profile & settings creation)
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at)
  VALUES (
    uid1,
    'user1@example.com',
    '{"display_name": "Student One"}'::jsonb,
    now(),
    now()
  ) ON CONFLICT (id) DO NOTHING;

  -- Insert User 2 into auth.users
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at)
  VALUES (
    uid2,
    'user2@example.com',
    '{"display_name": "Student Two"}'::jsonb,
    now(),
    now()
  ) ON CONFLICT (id) DO NOTHING;
END $$;

-- Verify handle_new_user trigger provisioned profiles & settings
SELECT ok(
  EXISTS(SELECT 1 FROM public.profiles WHERE id = '11111111-1111-1111-1111-111111111111'),
  'Profile automatically created for User 1 via auth trigger'
);

SELECT ok(
  EXISTS(SELECT 1 FROM public.settings WHERE user_id = '11111111-1111-1111-1111-111111111111'),
  'Settings automatically created for User 1 via auth trigger'
);

-- ----------------------------------------------------------------------------
-- Test 1 & 2: Authenticated user can create & read own subject
-- ----------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

INSERT INTO public.subjects (id, user_id, name, color)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Math 101', '#7c3aed');

SELECT is(
  (SELECT count(*)::integer FROM public.subjects WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'Authenticated User 1 can insert and read their own subject'
);

-- User 1 creates a task and a note for later tests
INSERT INTO public.tasks (id, user_id, subject_id, title, priority)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Homework 1', 'high');

INSERT INTO public.notes (id, user_id, subject_id, title, content)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Lecture 1 Notes', 'Intro to calculus');

-- ----------------------------------------------------------------------------
-- Test 3: Authenticated user cannot read another user''s subject
-- ----------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

SELECT is(
  (SELECT count(*)::integer FROM public.subjects WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0,
  'Authenticated User 2 cannot read User 1''s subject (RLS filtered)'
);

-- ----------------------------------------------------------------------------
-- Test 4: Authenticated user cannot update another user''s task
-- ----------------------------------------------------------------------------
-- User 2 attempts to update User 1's task
UPDATE public.tasks
SET title = 'Tampered Title'
WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- Verify title remains unchanged
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

SELECT is(
  (SELECT title FROM public.tasks WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'Homework 1',
  'Authenticated User 2 cannot update User 1''s task'
);

-- ----------------------------------------------------------------------------
-- Test 5: Authenticated user cannot delete another user''s note
-- ----------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

-- User 2 attempts to delete User 1's note
DELETE FROM public.notes WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

-- Verify note still exists under User 1
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

SELECT ok(
  EXISTS(SELECT 1 FROM public.notes WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'Authenticated User 2 cannot delete User 1''s note'
);

-- ----------------------------------------------------------------------------
-- Test 6: Habit completion uniqueness constraint
-- ----------------------------------------------------------------------------
-- Create habit for User 1
INSERT INTO public.habits (id, user_id, name, frequency)
VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'Daily Reading', 'daily');

-- Insert first completion for 2026-09-15
INSERT INTO public.habit_completions (id, user_id, habit_id, date)
VALUES ('e1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', '2026-09-15');

SELECT throws_ok(
  $$
  INSERT INTO public.habit_completions (id, user_id, habit_id, date)
  VALUES ('e2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', '2026-09-15')
  $$,
  '23505', -- unique_violation SQLSTATE
  NULL,
  'Habit completion uniqueness constraint rejects duplicate (habit_id, date)'
);

-- ----------------------------------------------------------------------------
-- Test 7: Cross-user foreign key references are rejected
-- User 2 attempts to create a task referencing User 1''s subject
-- ----------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

SELECT throws_ok(
  $$
  INSERT INTO public.tasks (id, user_id, subject_id, title)
  VALUES ('ffffffff-ffff-ffff-ffff-ffffffffffff', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Cross-user Task')
  $$,
  NULL,
  NULL,
  'Cross-user reference (User 2 task referencing User 1 subject) is rejected'
);

-- User 2 attempts to create a habit completion referencing User 1''s habit
SELECT throws_ok(
  $$
  INSERT INTO public.habit_completions (id, user_id, habit_id, date)
  VALUES ('faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'dddddddd-dddd-dddd-dddd-dddddddddddd', '2026-09-15')
  $$,
  NULL,
  NULL,
  'Cross-user reference (User 2 completion referencing User 1 habit) is rejected'
);

-- ----------------------------------------------------------------------------
-- Test 8: Unauthenticated access is denied across user-owned tables
-- ----------------------------------------------------------------------------
SET LOCAL ROLE anon;
SET LOCAL "request.jwt.claims" = '{"role": "anon"}';

SELECT is(
  (SELECT count(*)::integer FROM public.subjects),
  0,
  'Unauthenticated anon cannot read subjects'
);

SELECT is(
  (SELECT count(*)::integer FROM public.tasks),
  0,
  'Unauthenticated anon cannot read tasks'
);

SELECT is(
  (SELECT count(*)::integer FROM public.notes),
  0,
  'Unauthenticated anon cannot read notes'
);

SELECT is(
  (SELECT count(*)::integer FROM public.habits),
  0,
  'Unauthenticated anon cannot read habits'
);

SELECT is(
  (SELECT count(*)::integer FROM public.settings),
  0,
  'Unauthenticated anon cannot read settings'
);

SELECT * FROM finish();
ROLLBACK;
