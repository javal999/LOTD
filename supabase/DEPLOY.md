# LOTD — wiring to Supabase (M5)

Everything here is written and reviewed; it gets *validated* when you connect a real
Supabase project. Claude can't create accounts or handle the secret keys — those
steps are yours. Nothing secret goes in chat or in git.

## What you provide
- A **Supabase** account + project (free tier is plenty).
- A **host** for the static site: Vercel or Netlify (either).

## 1. Create the schema + seed
In the Supabase dashboard → SQL editor, run, in order:
1. `migrations/0001_init.sql` — tables, constraints, indexes, RLS.
2. `seed.sql` — the 4 players + active Season 1.

(Or with the CLI: `supabase db push` then `supabase db execute -f supabase/seed.sql`.)

## 2. Deploy the admin Edge Function
```
supabase functions deploy admin --project-ref <your-ref>
supabase secrets set ADMIN_PASSCODE='<pick-a-passcode>' --project-ref <your-ref>
```
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — do **not**
set or paste them. The passcode lives only as a function secret; the browser never has it.

## 3. Point the frontend at the project
Give Claude the **Project URL** and **anon public key** (both safe to share — the anon
key is read-only under RLS). Then `js/api.js` swaps its mock bodies for these:

```js
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const sb = createClient(SUPABASE_URL, ANON_KEY);

// READS (anon, RLS read-only): fetch seasons + players + games, map to the app shape.
async function load() {
  const [{ data: seasons }, { data: players }, { data: rows }] =
    await Promise.all([sb.from('seasons').select('*'), sb.from('players').select('*'),
                       sb.from('games').select('*').order('played_at')]);
  const games = rows.map((g) => ({ id: g.id, season_id: g.season_id,
    players: [g.p1, g.p2, g.p3, g.p4], loser: g.loser, played_at: g.played_at }));
  // active season = seasons.find(s => s.is_active); current standings tally its games.
}

// WRITES: POST to the Edge Function with the passcode held in the session (never stored).
async function call(action, payload) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, passcode: sessionPasscode, payload }),
  });
  const out = await res.json();
  if (!out.ok) throw new Error(out.error);
  return out.data;
}
// logGame -> call('log_game', { players, loser }); undoLast -> call('undo_last', {});
// editLoser -> call('edit_loser', { game_id, loser }); deleteGame -> call('delete_game', { game_id });
// startSeason -> call('start_season', { name })
```
`unlock(passcode)` becomes a real check: the first successful write proves the passcode;
until then, keep it in `sessionStorage` only.

## 4. Verification (the tests that need a live DB — run once at wiring)
- **Write works:** `log_game` inserts a row with the right p1..p4 + loser; standings update.
- **Anon can't write (the important one):** with the anon key, `sb.from('games').insert(...)`
  is **rejected** by RLS. This is the whole security model — confirm it fails.
- **Invariant holds server-side:** a `log_game` with a repeated player or an out-of-table
  loser returns 400 and inserts nothing (function check + DB CHECK).
- **Lockout:** 5 wrong passcodes from one IP → 429 for ~60s.
- **Cross-device:** log on phone A, refresh on phone B → the game shows.

## Rollback
Redeploy the previous static build to undo a frontend change; data in Supabase is
untouched. Schema changes are reversible migrations. In-app: undo-last, season archive,
and export give three recovery layers before anything is truly lost.
