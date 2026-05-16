// =====================================================================
// Wizard Browser — build/runtime configuration
// =====================================================================
//
// SAFE TO COMMIT. `SUPABASE_ANON` is a *publishable* key. Supabase
// publishable / anon keys are explicitly designed to ship inside client
// applications — Row Level Security (RLS) is what actually protects the
// data, not the secrecy of this key. The Wizard Extension Store's RLS
// only exposes `SELECT` on `extensions` rows where `status = 'live'`,
// and public reads of the `extensions` storage bucket.
//
// NEVER put a `service_role` / secret key in this file. That key bypasses
// RLS and would be a real credential leak if committed or shipped.
//
// (This is a config module rather than a .env file on purpose: .env is
// gitignored, so it would not be bundled into the packaged app by
// electron-builder and the feature would silently break in production.
// A committed module is the correct pattern for non-secret client config.)

module.exports = {
  SUPABASE_URL:  'https://ctktxrzifkvjqkiluqjy.supabase.co',
  SUPABASE_ANON: 'sb_publishable_Avcc_qQf5E6PNOiNYuZNmg_yyKjFvRV'
};
