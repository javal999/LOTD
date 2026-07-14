// Supabase project config.
//
// The anon key is a PUBLIC key: it is designed to ship in the browser, and row-level
// security keeps it read-only (we proved anon cannot write). It is NOT a secret and is
// safe to commit. The service_role key and the admin passcode live only server-side in
// the Edge Function — they must never appear here.
export const SUPABASE_URL = 'https://ptpijvdsyrlpqwctkzbp.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0cGlqdmRzeXJscHF3Y3RremJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwMzI1OTEsImV4cCI6MjA5OTYwODU5MX0.qwhZaBqiBkrogUELFb6iVXlqAN7fS8itacLx8kdd6Gc';

// 'mock'     = in-memory demo data; works with no backend (current default).
// 'supabase' = live reads (anon key) + writes via the admin Edge Function.
// Flip to 'supabase' after the schema + admin function are deployed (supabase/DEPLOY.md steps 3-6).
export const BACKEND = 'supabase';
