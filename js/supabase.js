/* ==========================================================================
   supabase.js — Shared Browser Supabase Client Module (StudyFlow v2.0)
   --------------------------------------------------------------------------
   Provides a safe, singleton Supabase client for browser environments with:
   - Configuration validation
   - Strict security guards prohibiting secret/service_role keys
   - Graceful fallback when configuration is missing or invalid
   - Zero side-effects on local-first v1.5.0 application logic
   ========================================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    // Node.js / CommonJS test environment
    module.exports = factory();
  } else {
    // Browser global
    root.StudyFlowSupabase = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  let _clientInstance = null;
  let _lastConfigState = null;

  /**
   * Helper to inspect a JWT payload non-destructively without verifying signature.
   * Used strictly for browser safety guards to detect service_role keys.
   */
  function parseJwtPayload(token) {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = typeof atob === 'function'
        ? atob(base64)
        : Buffer.from(base64, 'base64').toString('utf8');
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  /**
   * Validates Supabase configuration object.
   * Returns { valid: boolean, errors: string[], warnings: string[], isSecretKey: boolean }
   */
  function validateConfig(config) {
    const errors = [];
    const warnings = [];
    let isSecretKey = false;

    if (!config || typeof config !== 'object') {
      errors.push('Configuration must be a non-null object.');
      return { valid: false, errors, warnings, isSecretKey: false };
    }

    const url = typeof config.url === 'string' ? config.url.trim() : '';
    const publishableKey = typeof config.publishableKey === 'string'
      ? config.publishableKey.trim()
      : (typeof config.apiKey === 'string' ? config.apiKey.trim() : '');

    // 1. URL validation
    if (!url) {
      errors.push('Supabase URL is required.');
    } else {
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          errors.push('Supabase URL must use http:// or https://.');
        }
        if (parsed.protocol === 'http:' && !parsed.hostname.includes('localhost') && parsed.hostname !== '127.0.0.1') {
          warnings.push('Insecure HTTP protocol detected for non-localhost Supabase URL.');
        }
      } catch {
        errors.push('Invalid Supabase URL format.');
      }
    }

    // 2. Key validation
    if (!publishableKey) {
      errors.push('Supabase publishableKey is required.');
    } else {
      // CRITICAL SECURITY GUARD: Inspect key for secret/service_role markers
      const lower = publishableKey.toLowerCase();
      if (lower.startsWith('sb_sec_') || lower.includes('service_role') || lower.includes('secret')) {
        isSecretKey = true;
        errors.push('CRITICAL SECURITY VIOLATION: Secret or service_role key detected. Only public/publishable keys are permitted in browser code.');
      }

      // If JWT, inspect claims
      const payload = parseJwtPayload(publishableKey);
      if (payload && (payload.role === 'service_role' || payload.role === 'postgres' || payload.role === 'superuser')) {
        isSecretKey = true;
        errors.push(`CRITICAL SECURITY VIOLATION: JWT with role "${payload.role}" detected. Only public anon/publishable keys are permitted in browser code.`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      isSecretKey
    };
  }

  /**
   * Retrieves active configuration from window.STUDYFLOW_SUPABASE_CONFIG
   * or a custom override if provided.
   */
  function getConfig(overrideConfig) {
    if (overrideConfig && typeof overrideConfig === 'object') {
      return overrideConfig;
    }
    const globalConfig = (typeof window !== 'undefined' && window.STUDYFLOW_SUPABASE_CONFIG) ||
      (typeof globalThis !== 'undefined' && globalThis.STUDYFLOW_SUPABASE_CONFIG);
    if (globalConfig) {
      return globalConfig;
    }
    return { url: '', publishableKey: '' };
  }

  /**
   * Returns true if a valid, safe configuration is currently loaded.
   */
  function isConfigured(config) {
    const cfg = getConfig(config);
    const result = validateConfig(cfg);
    return result.valid;
  }

  /**
   * Returns the shared Supabase client singleton, or null if unconfigured/invalid.
   * Never throws uncaught errors into the application.
   */
  function getClient(options = {}) {
    const { customConfig = null, forceReinit = false, customSupabaseLib = null } = options;

    if (_clientInstance && !forceReinit) {
      return _clientInstance;
    }

    const cfg = getConfig(customConfig);
    const validation = validateConfig(cfg);
    _lastConfigState = validation;

    if (!validation.valid) {
      if (validation.isSecretKey) {
        console.error('[StudyFlow Supabase Security] Initialization aborted due to security violation:', validation.errors);
      } else if (cfg.url || cfg.publishableKey) {
        console.warn('[StudyFlow Supabase] Configuration incomplete or invalid:', validation.errors);
      } else {
        // Normal state when running 100% offline / local without cloud config
        // Silent or debug notice only
      }
      _clientInstance = null;
      return null;
    }

    // Resolve Supabase SDK factory
    const supabaseLib = customSupabaseLib ||
      (typeof window !== 'undefined' && window.supabase) ||
      (typeof globalThis !== 'undefined' && globalThis.supabase);

    if (!supabaseLib || typeof supabaseLib.createClient !== 'function') {
      console.info('[StudyFlow Supabase] Supabase JS SDK library not loaded on page. Client unavailable.');
      _clientInstance = null;
      return null;
    }

    try {
      const client = supabaseLib.createClient(cfg.url, cfg.publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
      _clientInstance = client;
      return _clientInstance;
    } catch (err) {
      console.error('[StudyFlow Supabase] Failed to initialize client:', err);
      _clientInstance = null;
      return null;
    }
  }

  /**
   * Resets the cached client instance (useful for tests or runtime reconfig).
   */
  function reset() {
    _clientInstance = null;
    _lastConfigState = null;
  }

  /**
   * Returns diagnostic information about client configuration state.
   */
  function getDiagnostics() {
    const cfg = getConfig();
    const validation = validateConfig(cfg);
    const hasSdk = typeof window !== 'undefined' && Boolean(window.supabase && window.supabase.createClient);

    return {
      configured: validation.valid,
      sdkLoaded: hasSdk,
      clientActive: Boolean(_clientInstance),
      url: cfg.url ? cfg.url.replace(/\.supabase\.co.*$/, '.supabase.co') : null,
      errors: validation.errors,
      warnings: validation.warnings
    };
  }

  return {
    validateConfig,
    getConfig,
    isConfigured,
    getClient,
    reset,
    getDiagnostics
  };
});
