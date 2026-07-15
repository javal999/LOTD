// Template for js/config.js — copy to config.js and fill in your own project.
//
// SUPABASE_ANON_KEY is a PUBLIC key (Settings -> API -> "anon public"): it ships in the
// browser by design and RLS keeps it read-only, so committing it is safe. Never put the
// service_role key or the admin passcode here — those live only in the Edge Function env
// (`supabase secrets set ADMIN_PASSCODE=...`).

const PROD = {
  url: 'https://YOUR-PROJECT-REF.supabase.co',
  anonKey: 'YOUR-ANON-PUBLIC-KEY',
  adminFn: 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/admin',
};

// Local `supabase start` stack. The demo anon key is the same on every machine.
const LOCAL = {
  url: 'http://127.0.0.1:54321',
  anonKey: 'YOUR-LOCAL-ANON-KEY-FROM-supabase-status',
  adminFn: 'http://localhost:8000',
};

const isLocal = ['localhost', '127.0.0.1'].includes(globalThis.location?.hostname);
const active = isLocal ? LOCAL : PROD;

export const SUPABASE_URL = active.url;
export const SUPABASE_ANON_KEY = active.anonKey;
export const ADMIN_FN = active.adminFn;
