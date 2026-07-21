// Supabase config.
//
// The anon key is a PUBLIC key: it is designed to ship in the browser, and row-level
// security keeps it read-only (proven by test). It is NOT a secret and is safe to commit.
// The service_role key and the admin passcode live only in the Edge Function env.
//
// Served from localhost => talk to the local Supabase stack (`supabase start`), so local
// development never touches production data. Anywhere else => the live project.

const PROD = {
  url: 'https://ptpijvdsyrlpqwctkzbp.supabase.co',
  anonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0cGlqdmRzeXJscHF3Y3RremJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwMzI1OTEsImV4cCI6MjA5OTYwODU5MX0.qwhZaBqiBkrogUELFb6iVXlqAN7fS8itacLx8kdd6Gc',
  adminFn: 'https://ptpijvdsyrlpqwctkzbp.supabase.co/functions/v1/admin',
};

// The local stack's demo anon key — identical on every machine, not a secret.
// adminFn points at the function run under raw Deno (Colima can't host the edge runtime).
const LOCAL = {
  url: 'http://127.0.0.1:54321',
  anonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
  adminFn: 'http://localhost:8000',
};

const isLocal = ['localhost', '127.0.0.1'].includes(globalThis.location?.hostname);
const active = isLocal ? LOCAL : PROD;

export const SUPABASE_URL = active.url;
export const SUPABASE_ANON_KEY = active.anonKey;
export const ADMIN_FN = active.adminFn;

// Demo / mock mode: open the app with `?mock=1` to run entirely on in-memory data with no
// Supabase and no passcode — so it is fully playable with just `python3 -m http.server`.
// Data resets on reload. This is what the README's "mock" promise refers to.
export const USE_MOCK = new URLSearchParams(globalThis.location?.search ?? '').has('mock');
