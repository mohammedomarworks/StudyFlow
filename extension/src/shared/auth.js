/* ==========================================================================
   auth.js — Authentication Services for StudyFlow Extension
   --------------------------------------------------------------------------
   Handles login, logout, session persistence, and auth state listeners
   using the shared StudyFlow Supabase client.
   ========================================================================== */

import { getSupabaseClient } from './supabase.js';

/**
 * Formats backend auth errors into clean, human-friendly messages.
 */
export function formatAuthError(err) {
  if (!err) return 'An unexpected authentication error occurred.';
  const msg = typeof err === 'string' ? err : (err.message || '');
  const lower = msg.toLowerCase();
  const code = (err.code || err.status || '').toString().toLowerCase();

  if (lower.includes('invalid login credentials') || lower.includes('invalid_credentials')) {
    return 'Incorrect email or password. Please try again.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Please confirm your email address before signing in.';
  }
  if (lower.includes('user not found')) {
    return 'No account found with this email.';
  }
  if (code === '429' || lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'Too many attempts. Please wait a few moments and try again.';
  }
  if (lower.includes('network') || lower.includes('failed to fetch')) {
    return 'Unable to connect to StudyFlow cloud. Check your network connection.';
  }
  return msg || 'Authentication failed. Please check your credentials.';
}

/**
 * Signs in with email and password.
 */
export async function signIn(email, password) {
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    throw new Error('Please enter a valid email address.');
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }

  const client = getSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password
  });

  if (error) {
    throw new Error(formatAuthError(error));
  }

  return data;
}

/**
 * Signs out of the active session.
 */
export async function signOut() {
  const client = getSupabaseClient();
  const { error } = await client.auth.signOut();
  if (error) {
    console.warn('[StudyFlow Extension] Sign out error:', error);
  }
  return true;
}

/**
 * Retrieves the current session (or null if signed out).
 */
export async function getSession() {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client.auth.getSession();
    if (error || !data) return null;
    return data.session;
  } catch (e) {
    console.warn('[StudyFlow Extension] getSession error:', e);
    return null;
  }
}

/**
 * Retrieves the currently authenticated user (or null).
 */
export async function getUser() {
  try {
    const client = getSupabaseClient();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return null;

    // Attach convenience display name
    const meta = user.user_metadata || {};
    const displayName = meta.display_name || meta.full_name || meta.name || user.email.split('@')[0];

    return {
      id: user.id,
      email: user.email,
      displayName
    };
  } catch (e) {
    console.warn('[StudyFlow Extension] getUser error:', e);
    return null;
  }
}

/**
 * Subscribes to Supabase auth state changes.
 */
export function onAuthStateChange(callback) {
  const client = getSupabaseClient();
  const { data: { subscription } } = client.auth.onAuthStateChange(async (event, session) => {
    let user = null;
    if (session && session.user) {
      const meta = session.user.user_metadata || {};
      const displayName = meta.display_name || meta.full_name || meta.name || session.user.email.split('@')[0];
      user = {
        id: session.user.id,
        email: session.user.email,
        displayName
      };
    }
    callback(event, session, user);
  });

  return () => {
    subscription.unsubscribe();
  };
}

export default {
  signIn,
  signOut,
  getSession,
  getUser,
  onAuthStateChange,
  formatAuthError
};
