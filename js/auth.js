/* ==========================================================================
   auth.js — Dedicated Supabase Authentication Module (StudyFlow v2.0)
   --------------------------------------------------------------------------
   Provides centralized authentication and identity services:
   - Registration with display name metadata
   - Email/password authentication
   - Session persistence and auto-recovery
   - Password reset and recovery flows
   - Centralized auth state (loading, authenticated, unauthenticated, error)
   - Listener subscription pattern for decoupled UI updates
   - Strict protection for v1.5.0 local-first data (Sign Out != Clear Local Data)
   - Safe return-destination redirect validation (no open redirects)
   ========================================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    // Node.js test environment
    module.exports = factory();
  } else {
    // Browser global
    root.Auth = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Central Auth States
  const STATE = {
    LOADING: 'loading',
    AUTHENTICATED: 'authenticated',
    UNAUTHENTICATED: 'unauthenticated',
    ERROR: 'error'
  };

  let _state = STATE.LOADING;
  let _session = null;
  let _user = null;
  let _profile = null;
  let _client = null;
  let _listeners = [];
  let _initPromise = null;
  let _authSubscription = null;

  /**
   * Translates backend/GoTrue errors into clean, human-friendly messages.
   */
  function formatAuthError(err) {
    if (!err) return 'An unexpected authentication error occurred.';
    if (typeof err === 'string') {
      const lower = err.toLowerCase();
      if (lower.includes('invalid login credentials') || lower.includes('invalid_credentials')) {
        return 'Email or password is incorrect.';
      }
      if (lower.includes('email not confirmed')) {
        return 'Please verify your email before signing in.';
      }
      if (lower.includes('user already registered') || lower.includes('already exists')) {
        return 'An account with this email already exists.';
      }
      if (lower.includes('rate limit') || lower.includes('too many requests')) {
        return 'Too many requests. Please wait a moment and try again.';
      }
      if (lower.includes('password') && (lower.includes('6 characters') || lower.includes('short') || lower.includes('weak'))) {
        return 'Password must be at least 6 characters.';
      }
      if (lower.includes('network') || lower.includes('failed to fetch')) {
        return 'Unable to reach authentication service. Check your connection and try again.';
      }
      return err;
    }

    const msg = err.message || '';
    const lowerMsg = msg.toLowerCase();
    const code = (err.code || err.status || '').toString().toLowerCase();

    if (lowerMsg.includes('invalid login credentials') || code === 'invalid_credentials') {
      return 'Email or password is incorrect.';
    }
    if (lowerMsg.includes('email not confirmed')) {
      return 'Please verify your email before signing in.';
    }
    if (lowerMsg.includes('user already registered')) {
      return 'An account with this email already exists.';
    }
    if (code === '429' || lowerMsg.includes('rate limit') || lowerMsg.includes('too many requests')) {
      return 'Too many requests. Please wait a moment and try again.';
    }
    if (lowerMsg.includes('password') && (lowerMsg.includes('6 characters') || lowerMsg.includes('short'))) {
      return 'Password must be at least 6 characters.';
    }
    if (lowerMsg.includes('network') || lowerMsg.includes('failed to fetch')) {
      return 'Unable to reach authentication service. Check your connection and try again.';
    }

    return msg || 'Authentication request failed. Please try again.';
  }

  /**
   * Simple email validation helper.
   */
  function isValidEmail(email) {
    if (typeof email !== 'string') return false;
    const trimmed = email.trim();
    return trimmed.length >= 3 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  }

  /**
   * Resolves the Supabase client safely from StudyFlowSupabase.
   */
  function resolveClient(overrideClient) {
    if (overrideClient) return overrideClient;
    if (_client) return _client;

    const sf = (typeof window !== 'undefined' && window.StudyFlowSupabase) ||
               (typeof globalThis !== 'undefined' && globalThis.StudyFlowSupabase);

    if (sf && typeof sf.getClient === 'function') {
      _client = sf.getClient();
      return _client;
    }
    return null;
  }

  /**
   * Notifies all registered listeners of auth state updates.
   */
  function notifyListeners(event, session, user) {
    _listeners.forEach(fn => {
      try {
        fn(event, session, user, _state);
      } catch (e) {
        console.error('[StudyFlow Auth] Listener error:', e);
      }
    });
  }

  /**
   * Normalizes user identity for UI consumption.
   */
  function normalizeUser(rawUser) {
    if (!rawUser) return null;
    const meta = rawUser.user_metadata || {};
    const email = rawUser.email || '';
    const emailPrefix = email ? email.split('@')[0] : 'Student';
    const displayName = (meta.display_name || meta.full_name || emailPrefix).trim();

    return {
      id: rawUser.id,
      email: email,
      displayName: displayName || 'Student',
      avatarUrl: meta.avatar_url || null,
      raw: rawUser
    };
  }

  /**
   * Initialize Supabase Auth:
   * 1. Reads existing session.
   * 2. Registers auth state listener.
   * 3. Sets application auth state without flashing.
   */
  async function init(options = {}) {
    if (_initPromise && !options.forceReinit) {
      return _initPromise;
    }

    _initPromise = (async () => {
      const client = resolveClient(options.customClient);

      if (!client || !client.auth) {
        _state = STATE.UNAUTHENTICATED;
        _session = null;
        _user = null;
        return {
          configured: false,
          state: _state,
          session: null,
          user: null
        };
      }

      try {
        // Read persisted session
        const { data, error } = await client.auth.getSession();

        if (error) {
          console.warn('[StudyFlow Auth] Session retrieval error:', error.message);
          _state = STATE.UNAUTHENTICATED;
          _session = null;
          _user = null;
        } else if (data && data.session) {
          _session = data.session;
          _user = normalizeUser(data.session.user);
          _state = STATE.AUTHENTICATED;
        } else {
          _session = null;
          _user = null;
          _state = STATE.UNAUTHENTICATED;
        }

        // Attach auth state change listener if not already attached
        if (!_authSubscription) {
          const { data: subData } = client.auth.onAuthStateChange(async (event, session) => {
            if (session) {
              _session = session;
              _user = normalizeUser(session.user);
              _state = STATE.AUTHENTICATED;
            } else {
              _session = null;
              _user = null;
              _profile = null;
              _state = STATE.UNAUTHENTICATED;
            }

            notifyListeners(event, _session, _user);
          });
          _authSubscription = subData && subData.subscription;
        }

        return {
          configured: true,
          state: _state,
          session: _session,
          user: _user
        };
      } catch (err) {
        console.error('[StudyFlow Auth] Initialization exception:', err);
        _state = STATE.ERROR;
        return {
          configured: true,
          state: _state,
          error: formatAuthError(err)
        };
      }
    })();

    return _initPromise;
  }

  /**
   * Returns current session.
   */
  function getSession() {
    return _session;
  }

  /**
   * Returns current user identity.
   */
  function getUser() {
    return _user;
  }

  /**
   * Returns true if user is currently authenticated.
   */
  function isAuthenticated() {
    return _state === STATE.AUTHENTICATED && Boolean(_session);
  }

  /**
   * Returns current auth state: 'loading' | 'authenticated' | 'unauthenticated' | 'error'
   */
  function getState() {
    return _state;
  }

  /**
   * Register a new user with Supabase Auth.
   * Attaches display_name in user metadata for the Phase A database trigger.
   */
  async function signUp({ email, password, confirmPassword, displayName }) {
    const cleanEmail = (email || '').trim();
    const cleanName = (displayName || '').trim();
    const pass = password || '';

    // Validation
    if (!cleanEmail) {
      return { success: false, error: 'Email address is required.' };
    }
    if (!isValidEmail(cleanEmail)) {
      return { success: false, error: 'Please enter a valid email address.' };
    }
    if (!pass) {
      return { success: false, error: 'Password is required.' };
    }
    if (pass.length < 6) {
      return { success: false, error: 'Password must be at least 6 characters.' };
    }
    if (confirmPassword !== undefined && pass !== confirmPassword) {
      return { success: false, error: 'Passwords do not match.' };
    }

    const client = resolveClient();
    if (!client || !client.auth) {
      return {
        success: false,
        error: 'Authentication service is not configured or unavailable.'
      };
    }

    try {
      const { data, error } = await client.auth.signUp({
        email: cleanEmail,
        password: pass,
        options: {
          data: {
            display_name: cleanName || cleanEmail.split('@')[0]
          }
        }
      });

      if (error) {
        return { success: false, error: formatAuthError(error) };
      }

      const user = data && data.user;
      const session = data && data.session;
      const requiresEmailConfirmation = Boolean(user && !session);

      if (session) {
        _session = session;
        _user = normalizeUser(session.user);
        _state = STATE.AUTHENTICATED;
        notifyListeners('SIGNED_IN', _session, _user);
      }

      return {
        success: true,
        user: normalizeUser(user),
        session: session,
        requiresEmailConfirmation: requiresEmailConfirmation,
        error: null
      };
    } catch (err) {
      return { success: false, error: formatAuthError(err) };
    }
  }

  /**
   * Sign in with email and password.
   */
  async function signIn({ email, password }) {
    const cleanEmail = (email || '').trim();
    const pass = password || '';

    if (!cleanEmail) {
      return { success: false, error: 'Email address is required.' };
    }
    if (!isValidEmail(cleanEmail)) {
      return { success: false, error: 'Please enter a valid email address.' };
    }
    if (!pass) {
      return { success: false, error: 'Password is required.' };
    }

    const client = resolveClient();
    if (!client || !client.auth) {
      return {
        success: false,
        error: 'Authentication service is not configured or unavailable.'
      };
    }

    try {
      const { data, error } = await client.auth.signInWithPassword({
        email: cleanEmail,
        password: pass
      });

      if (error) {
        return { success: false, error: formatAuthError(error) };
      }

      if (data && data.session) {
        _session = data.session;
        _user = normalizeUser(data.session.user);
        _state = STATE.AUTHENTICATED;
        notifyListeners('SIGNED_IN', _session, _user);
      }

      return {
        success: true,
        user: _user,
        session: _session,
        error: null
      };
    } catch (err) {
      return { success: false, error: formatAuthError(err) };
    }
  }

  /**
   * Sign out the active user.
   * CRITICAL GUARANTEE: Does NOT clear or alter localStorage planner data!
   */
  async function signOut() {
    const client = resolveClient();

    try {
      if (client && client.auth) {
        await client.auth.signOut();
      }
    } catch (err) {
      console.warn('[StudyFlow Auth] Sign out warning:', err.message);
    } finally {
      // Always reset local auth session state regardless of network response
      _session = null;
      _user = null;
      _profile = null;
      _state = STATE.UNAUTHENTICATED;
      notifyListeners('SIGNED_OUT', null, null);
    }

    return { success: true };
  }

  /**
   * Request password reset link for email.
   */
  async function resetPassword(email, options = {}) {
    const cleanEmail = (email || '').trim();

    if (!cleanEmail) {
      return { success: false, error: 'Email address is required.' };
    }
    if (!isValidEmail(cleanEmail)) {
      return { success: false, error: 'Please enter a valid email address.' };
    }

    const client = resolveClient();
    if (!client || !client.auth) {
      return {
        success: false,
        error: 'Authentication service is not configured or unavailable.'
      };
    }

    try {
      let redirectTo = options.redirectTo;
      if (!redirectTo && typeof window !== 'undefined') {
        // Construct canonical URL to pages/auth.html with recovery type
        const origin = window.location.origin || '';
        const pathParts = window.location.pathname.split('/');
        pathParts.pop(); // remove current filename
        const basePath = pathParts.join('/');
        redirectTo = `${origin}${basePath}/auth.html?type=recovery`;
      }

      const { error } = await client.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: redirectTo
      });

      if (error) {
        return { success: false, error: formatAuthError(error) };
      }

      return { success: true, error: null };
    } catch (err) {
      return { success: false, error: formatAuthError(err) };
    }
  }

  /**
   * Updates password for the authenticated user (e.g., during recovery).
   */
  async function updatePassword(newPassword, confirmPassword) {
    const pass = newPassword || '';

    if (!pass) {
      return { success: false, error: 'New password is required.' };
    }
    if (pass.length < 6) {
      return { success: false, error: 'Password must be at least 6 characters.' };
    }
    if (confirmPassword !== undefined && pass !== confirmPassword) {
      return { success: false, error: 'Passwords do not match.' };
    }

    const client = resolveClient();
    if (!client || !client.auth) {
      return {
        success: false,
        error: 'Authentication service is not configured or unavailable.'
      };
    }

    try {
      const { data, error } = await client.auth.updateUser({
        password: pass
      });

      if (error) {
        return { success: false, error: formatAuthError(error) };
      }

      if (data && data.user) {
        _user = normalizeUser(data.user);
        notifyListeners('USER_UPDATED', _session, _user);
      }

      return { success: true, error: null };
    } catch (err) {
      return { success: false, error: formatAuthError(err) };
    }
  }

  /**
   * Fetches profile from public.profiles table.
   */
  async function getProfile(forceRefresh = false) {
    if (_profile && !forceRefresh) {
      return { data: _profile, error: null };
    }

    if (!isAuthenticated()) {
      return { data: null, error: 'User is not authenticated.' };
    }

    const client = resolveClient();
    if (!client) {
      return { data: null, error: 'Supabase client unavailable.' };
    }

    try {
      const { data, error } = await client
        .from('profiles')
        .select('*')
        .eq('id', _user.id)
        .single();

      if (error) {
        return { data: null, error: error.message };
      }

      _profile = data;
      return { data: _profile, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  }

  /**
   * Registers an auth state listener.
   * Returns an unsubscribe function.
   */
  function onAuthStateChange(callback) {
    if (typeof callback !== 'function') return () => {};

    _listeners.push(callback);

    // Call immediately if already initialized
    if (_state !== STATE.LOADING) {
      try {
        callback('INITIAL_STATE', _session, _user, _state);
      } catch (e) {
        console.error('[StudyFlow Auth] Immediate listener error:', e);
      }
    }

    return () => {
      _listeners = _listeners.filter(fn => fn !== callback);
    };
  }

  /**
   * Sanitizes redirect target URLs to prevent open redirect vulnerabilities.
   * Only permits safe internal StudyFlow page paths.
   */
  function sanitizeRedirect(url, defaultFallback = 'index.html') {
    if (typeof url !== 'string' || !url.trim()) {
      return defaultFallback;
    }

    const trimmed = url.trim();

    // Reject absolute URLs, protocol-relative, and dangerous URI schemes
    if (
      trimmed.includes('://') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('\\\\') ||
      trimmed.toLowerCase().startsWith('javascript:') ||
      trimmed.toLowerCase().startsWith('data:') ||
      trimmed.toLowerCase().startsWith('vbscript:') ||
      trimmed.includes('\0') ||
      trimmed.includes('\r') ||
      trimmed.includes('\n')
    ) {
      return defaultFallback;
    }

    // Must target index.html or pages/*.html
    const cleanPath = trimmed.split('?')[0].split('#')[0];
    const allowedTargets = [
      'index.html',
      '../index.html',
      'subjects.html',
      'pages/subjects.html',
      '../pages/subjects.html',
      'tasks.html',
      'pages/tasks.html',
      '../pages/tasks.html',
      'habits.html',
      'pages/habits.html',
      '../pages/habits.html',
      'calendar.html',
      'pages/calendar.html',
      '../pages/calendar.html',
      'timer.html',
      'pages/timer.html',
      '../pages/timer.html',
      'progress.html',
      'pages/progress.html',
      '../pages/progress.html',
      'notes.html',
      'pages/notes.html',
      '../pages/notes.html',
      'settings.html',
      'pages/settings.html',
      '../pages/settings.html',
      'about.html',
      'pages/about.html',
      '../pages/about.html'
    ];

    if (allowedTargets.includes(cleanPath)) {
      return trimmed;
    }

    return defaultFallback;
  }

  /**
   * Resets internal module state (primarily for tests).
   */
  function reset() {
    _state = STATE.LOADING;
    _session = null;
    _user = null;
    _profile = null;
    _client = null;
    _listeners = [];
    _initPromise = null;
    if (_authSubscription && typeof _authSubscription.unsubscribe === 'function') {
      _authSubscription.unsubscribe();
    }
    _authSubscription = null;
  }

  return {
    STATE,
    init,
    getSession,
    getUser,
    isAuthenticated,
    getState,
    signUp,
    signIn,
    signOut,
    resetPassword,
    updatePassword,
    getProfile,
    onAuthStateChange,
    sanitizeRedirect,
    formatAuthError,
    isValidEmail,
    reset
  };
});
