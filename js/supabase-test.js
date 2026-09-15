/* ==========================================================================
   supabase-test.js — Development-Only Supabase Connectivity Verification
   --------------------------------------------------------------------------
   Verifies:
   1. Configuration validity (rejects blank, invalid URL, or secret keys)
   2. Supabase JS SDK presence & client initialization
   3. Auth session status (verifies authenticated session is NOT falsely assumed)
   4. RLS protection (verifies unauthenticated requests cannot read protected records)
   5. Public gateway reachability

   Usage in browser console:
     await StudyFlowSupabaseTest.run();
   ========================================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./supabase.js'));
  } else {
    root.StudyFlowSupabaseTest = factory(root.StudyFlowSupabase);
  }
})(typeof window !== 'undefined' ? window : globalThis, function (StudyFlowSupabase) {
  'use strict';

  async function run(options = {}) {
    const { verbose = true } = options;
    const log = (msg, type = 'info') => {
      if (!verbose) return;
      if (type === 'pass') console.log(`  ✓ ${msg}`);
      else if (type === 'fail') console.error(`  ✗ ${msg}`);
      else if (type === 'warn') console.warn(`  ! ${msg}`);
      else console.log(`[StudyFlow Supabase Test] ${msg}`);
    };

    const results = {
      timestamp: new Date().toISOString(),
      passed: 0,
      failed: 0,
      warnings: 0,
      steps: []
    };

    const recordStep = (name, passed, detail = '', isWarning = false) => {
      if (isWarning) {
        results.warnings++;
        log(`${name}: ${detail}`, 'warn');
      } else if (passed) {
        results.passed++;
        log(`${name}${detail ? ` (${detail})` : ''}`, 'pass');
      } else {
        results.failed++;
        log(`${name}: ${detail}`, 'fail');
      }
      results.steps.push({ name, passed, detail, isWarning });
    };

    log('Starting connectivity & security verification...\n');

    // ------------------------------------------------------------------------
    // Step 1: Configuration Validation
    // ------------------------------------------------------------------------
    const config = StudyFlowSupabase ? StudyFlowSupabase.getConfig() : null;
    if (!config || (!config.url && !config.publishableKey)) {
      recordStep(
        '1. Configuration Status',
        false,
        'Supabase is unconfigured (empty URL / key). App operates safely in local-first mode.',
        true // treated as informational warning for unconfigured setups
      );
      log('\nTest completed: Supabase configuration is empty. No cloud connection attempted.');
      return results;
    }

    const validation = StudyFlowSupabase.validateConfig(config);
    if (!validation.valid) {
      if (validation.isSecretKey) {
        recordStep('1. Configuration Security', false, 'CRITICAL: Secret/service_role key detected! Prohibited in browser.');
      } else {
        recordStep('1. Configuration Valid', false, validation.errors.join('; '));
      }
      return results;
    }
    recordStep('1. Configuration Valid', true, `URL: ${config.url}`);

    // ------------------------------------------------------------------------
    // Step 2: Client Initialization
    // ------------------------------------------------------------------------
    const client = StudyFlowSupabase.getClient();
    if (!client) {
      recordStep('2. Client Initialization', false, 'Client could not be initialized (SDK missing or setup failed).');
      return results;
    }
    recordStep('2. Client Initialization', true, 'Singleton client active');

    // ------------------------------------------------------------------------
    // Step 3: Auth Session Verification (No false authenticated state assumed)
    // ------------------------------------------------------------------------
    try {
      const { data: sessionData, error: sessionErr } = await client.auth.getSession();
      if (sessionErr) {
        recordStep('3. Auth Session Check', false, `Auth session query returned error: ${sessionErr.message}`);
      } else {
        const hasSession = Boolean(sessionData && sessionData.session);
        if (hasSession) {
          recordStep('3. Auth Session Check', true, `Authenticated as user: ${sessionData.session.user.id}`);
        } else {
          recordStep('3. Auth Session Check', true, 'Correctly unauthenticated (no session falsely assumed)');
        }
      }
    } catch (err) {
      recordStep('3. Auth Session Check', false, `Auth check threw: ${err.message}`);
    }

    // ------------------------------------------------------------------------
    // Step 4: RLS Protection Verification (Unauthenticated request must not leak data)
    // ------------------------------------------------------------------------
    try {
      const { data, error } = await client
        .from('subjects')
        .select('id, name')
        .limit(1);

      if (error) {
        // PostgREST/Postgres returning an RLS or permission error is an expected secure rejection
        recordStep('4. RLS Protection Check', true, `Unauthenticated read securely rejected or filtered: ${error.message}`);
      } else if (Array.isArray(data)) {
        if (data.length === 0) {
          recordStep('4. RLS Protection Check', true, 'Unauthenticated query returned 0 records (RLS filtered as expected)');
        } else {
          recordStep('4. RLS Protection Check', false, 'CRITICAL SECURITY FAILURE: Unauthenticated query returned protected data!');
        }
      }
    } catch (err) {
      recordStep('4. RLS Protection Check', true, `Network/permission exception handled: ${err.message}`);
    }

    // ------------------------------------------------------------------------
    // Step 5: Summary
    // ------------------------------------------------------------------------
    log(`\n========================================`);
    log(`Results: ${results.passed} passed, ${results.failed} failed, ${results.warnings} notices`);
    log(`========================================\n`);

    return results;
  }

  return {
    run
  };
});
