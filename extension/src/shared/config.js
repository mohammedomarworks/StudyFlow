/* ==========================================================================
   config.js — Chrome Extension Configuration (StudyFlow v2.1.0)
   --------------------------------------------------------------------------
   Stores public connection endpoints and application URLs for the extension.

   SECURITY RULES:
   1. USE ONLY YOUR SUPABASE PROJECT URL AND PUBLIC / PUBLISHABLE KEY.
   2. NEVER PLACE SECRET KEYS HERE:
      - NO administrative secret keys
      - NO database passwords
      - NO secret backend keys
      - NO JWT secret keys
   ========================================================================== */

export const CONFIG = Object.freeze({
  version: '2.1.0',

  /**
   * Supabase Project URL
   */
  supabaseUrl: 'https://rlqjeilhsgnqjoazejca.supabase.co',

  /**
   * Supabase Public / Publishable API Key
   * Protected by PostgreSQL Row Level Security (RLS) on backend.
   */
  supabasePublishableKey: 'sb_publishable_BPp2b5BW0ElBhY2I7iZwTw_mdqw3kgg',

  /**
   * Main StudyFlow Production Web Application URL
   */
  appUrl: 'https://studyflow-productivity.netlify.app/',

  /**
   * StudyFlow Focus Timer Page URL
   */
  timerUrl: 'https://studyflow-productivity.netlify.app/pages/timer.html'
});

export default CONFIG;
