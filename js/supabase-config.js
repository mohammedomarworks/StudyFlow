/* ==========================================================================
   supabase-config.js — Supabase Project Configuration (StudyFlow v2.0)
   --------------------------------------------------------------------------
   This file provides the browser-side Supabase connection details.

   SECURITY RULES:
   1. USE ONLY YOUR SUPABASE PROJECT URL AND PUBLIC / PUBLISHABLE KEY.
   2. NEVER PLACE SECRET KEYS HERE:
      - NO `service_role` keys
      - NO secret backend keys
      - NO database passwords
      - NO JWT secret keys
   3. Publishable keys (e.g. `sb_pub_...` or standard Supabase anon keys)
      are designed for browser applications and are protected by PostgreSQL
      Row Level Security (RLS).
   4. For local development with your own credentials, you may also create
      `js/supabase-config.local.js` (which is ignored by Git).
   ========================================================================== */

window.STUDYFLOW_SUPABASE_CONFIG = {
  /**
   * Supabase Project URL
   * Example: "https://xyzcompany.supabase.co"
   */
  url: "https://rlqjeilhsgnqjoazejca.supabase.co",

  /**
   * Supabase Public / Publishable API Key
   * Example: "sb_pub_..." or your project's anon/public key.
   * MUST NOT be a service_role key!
   */
  publishableKey: "sb_publishable_BPp2b5BW0ElBhY2I7iZwTw_mdqw3kgg"
};
