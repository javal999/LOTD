# Build plan — Card game standings tracker

**Companion to:** TRD-2026-001-card-standings-tracker.md and PRD-card-game-standings-tracker.md (v3)
**Stack:** Supabase (Postgres + Edge Functions) + vanilla JS static frontend, hosted on Netlify or Vercel
**For:** building with Claude Code, epic by epic
**Date:** 2026-07-14 (aligned to PRD v3: leaderboards, in-UI player management, dated logging, loser spotlight)

---

## How to use this

Build in order. Each epic is one Claude Code session. Copy the prompt block into Claude Code, let it work, then check it against the acceptance criteria and run the tests before moving on. The epics follow the vibe-code-reviewer phase gates: spec is set (the TRD), tests come before implementation, and the last epic is the security and verification gate.

Two things only a human should do, per the reviewer: approve this plan before Claude Code starts, and read the final diff before you deploy.

**Model in one line:** a *leaderboard* is the top-level tracker (it replaced "seasons"). Players and games belong to a leaderboard. Every game is exactly 4 players and 1 loser, on a date that defaults to today and can't be in the future.

**Dependency order:**

```
E0 scaffold ─► E1 schema ─► E2 ranking+spotlight lib ─┬─► E4 read UI ─► E5 admin ─► E6 spotlight+export ─► E7 ship
                            └─► E3 edge fn ────────────┘
```

E2 (pure logic) and E3 (write path) can be built in either order after E1. Everything else is linear.

---

## Epic 0 — Repo scaffold and Supabase project

**Goal:** an empty, deployable skeleton and a Supabase dev project wired up.

**Depends on:** nothing.

**Claude Code prompt:**
> Create a minimal static web project for a card game standings tracker. No framework, no build step: `index.html`, `app.js`, `styles.css`, plus a `supabase/` folder for migrations and Edge Functions. The app tracks multiple "leaderboards"; each has its own players and games. Add a `README.md` documenting local run (open index.html or `npx serve`) and the two runtime env values the frontend needs: `SUPABASE_URL` and `SUPABASE_ANON_KEY`, loaded from a gitignored `config.js` (add a `config.example.js`). Add a `.gitignore` covering `config.js`, `.env`, `node_modules`. Do not hardcode any keys. Initialize the Supabase CLI structure under `supabase/`. Stop and show me the file tree before writing feature code.

**Acceptance criteria:**
- File tree exists; `index.html` loads locally with a clean console.
- No secrets committed; `config.js` gitignored with an example template.
- `supabase/` initialized for migrations and functions.

**Tests:** none (scaffold). Confirm the page opens.

**Rollback:** delete the folder.

---

## Epic 1 — Database schema, constraints, view, RLS, seed

**Goal:** the shared data model with the invariant enforced in the database, public read-only access, and one seeded leaderboard with 4 players. **No `seasons` table** (leaderboards replace it).

**Depends on:** E0.

**Spec (from TRD section 5):** three tables (`leaderboards`, `players`, `games`), one aggregation view (`v_standings`) scoped by leaderboard, RLS that allows anon SELECT and denies anon writes.

**Claude Code prompt:**
> Write a Supabase SQL migration under `supabase/migrations/` for a card game standings tracker with multiple leaderboards. Exactly:
> - `leaderboards(id bigint identity pk, name text not null unique, created_at timestamptz default now())`.
> - `players(id bigint identity pk, leaderboard_id bigint not null references leaderboards(id) on delete cascade, name text not null, archived boolean not null default false, created_at timestamptz default now())`. Add `unique(leaderboard_id, name)`.
> - `games(id bigint identity pk, leaderboard_id bigint not null references leaderboards(id) on delete cascade, game_date date not null default current_date, p1 bigint not null references players(id), p2 ... p3 ... p4 bigint not null references players(id), loser bigint not null references players(id), created_at timestamptz default now())`. The player foreign keys must be ON DELETE RESTRICT (default), so a player with games cannot be hard-deleted.
> - On `games`, add CHECK constraints: p1,p2,p3,p4 all distinct; `loser IN (p1,p2,p3,p4)`; and a loose future guard `game_date <= current_date + 1` (timezone slack; strict future-blocking is enforced in the Edge Function).
> - Create view `v_standings`: for each `(leaderboard_id, player)`, `gp` = games the player was in (any of p1..p4), `losses` = games where they were the loser. Include `archived`. Do not compute loss rate or rank in SQL; the frontend does that.
> - Enable RLS on all three tables. Add policies so the `anon` role can `SELECT` on leaderboards, players, games, and read `v_standings`. Add no anon INSERT/UPDATE/DELETE policies.
> - A seed migration: one leaderboard "Leaderboard 1" and four players Player1..Player4 in it (I will rename them).
> Show me the SQL before applying, then tell me exactly how to apply it to my Supabase dev project.

**Acceptance criteria:**
- Migration applies cleanly to a fresh project.
- A game with a repeated player, or a `loser` not among p1..p4, is rejected.
- Deleting a leaderboard cascades to its players and games; deleting a player who has games is rejected by the FK (the app archives instead).
- Anon key: SELECT on `v_standings` works; INSERT into `games` is rejected.

**Tests (against the dev project):**
1. Insert a valid game → succeeds.
2. Insert a game with p1 = p2 → rejected.
3. Insert a game with loser not in p1..p4 → rejected.
4. Delete a leaderboard with games → its players and games are gone (cascade).
5. Hard-delete a player who has games → rejected by FK RESTRICT.
6. Anon-key INSERT into `games` → rejected by RLS; anon-key SELECT on `v_standings` → allowed.

**Rollback:** `down` migration drops the view and tables. Dev-only data.

---

## Epic 2 — Ranking and spotlight library (pure JavaScript, test-first)

**Goal:** the standings math and the two biggest-loser calculations, as a pure module with no database, fully unit-testable. Highest-value code to get right.

**Depends on:** E1 (for input row shape).

**Spec (PRD 2, 7.5, 14.4):**
- `computeStandings(rows, mode)`: `rows` = `[{name, gp, losses, archived}]`; `mode` = `"most_not_lost" | "highest_loss_rate"`. Output `{ ranked:[...rank 1..n], unranked:[...] }`.
- `biggestLoserAllTime(rows)`: the name(s) with the most `losses` (absolute). Returns an array (ties → multiple).
- `biggestLoserForDate(games, players, dateStr)`: among games whose `game_date === dateStr`, the player(s) with the most losses that day. Returns an array.

**Write tests first**, using these hand-computed vectors (PRD Appendix A):

Input (all played 10): `Ade l1, Bima l4, Citra l3, Dewi l2`.
- `most_not_lost` → Ade(9), Dewi(8), Citra(7), Bima(6).
- `highest_loss_rate` → Bima(40%), Citra(30%), Dewi(20%), Ade(10%). (Descending since 2026-07-15: rank 1 is the biggest loser, matching the spotlight.)
- Add `Eka gp2 l0`: `most_not_lost` → Eka last (2); `highest_loss_rate` → Eka unranked (provisional, gp<5).
- `biggestLoserAllTime` → `["Bima"]` (4 losses, the most).
- Two players tied at the top of losses → both names returned.

**Claude Code prompt:**
> First write a test file for a pure module `ranking.js`, then implement it to pass. Do not implement before the tests exist and fail.
> Exports:
> - `computeStandings(rows, mode)`: `rows` = `[{name, gp, losses, archived}]`. `games_not_lost = gp - losses`; `loss_rate = losses/gp` or `null` if `gp===0`; `provisional = gp < 5`. Mode `most_not_lost`: rank all by games_not_lost desc; tiebreak lower loss_rate, then more gp, then name A→Z. Mode `highest_loss_rate`: rank only non-provisional by loss_rate **desc**; tiebreak more gp, then **fewer** games_not_lost, then name A→Z; provisional and gp=0 go to a separate `unranked` list. Archived players are still included (their games happened); just carry the `archived` flag through.
> - `biggestLoserAllTime(rows)`: return an array of the name(s) with the maximum `losses`. Empty array if no games.
> - `biggestLoserForDate(games, players, dateStr)`: `games` = `[{game_date, loser}]` (player id), `players` = `[{id,name}]`. Among games with `game_date === dateStr`, return the name(s) with the most losses that day. Empty array if none.
> Cover as tests: the equal-GP vectors (both modes), the Eka provisional case (both modes), a gp=0 player (unranked, null loss_rate, no divide-by-zero), each tiebreak level, `biggestLoserAllTime` single and tie, `biggestLoserForDate` for a day with games and a day with none. Show failing tests first, then green.

**Acceptance criteria:**
- Tests written before implementation and fail first (no tautological tests).
- All vectors pass. No divide-by-zero. Provisional players never take a loss-rate rank. Ties return every tied name.

**Rollback:** revert the two files. Pure code.

---

## Epic 3 — Admin write Edge Function (passcode-gated, 10 actions)

**Goal:** the only write path. Holds the write secret server-side; covers leaderboards, players, and games.

**Depends on:** E1.

**Spec (TRD 5c):** `POST` `{ action, passcode, payload }`; returns `{ ok, data?, error? }`. Actions: `create_leaderboard, rename_leaderboard, delete_leaderboard, add_player, delete_player, restore_player, log_game, undo_last, edit_loser, delete_game`.

**Claude Code prompt:**
> Write a Supabase Edge Function `admin` (Deno/TypeScript) that is the only way to write data. It reads `ADMIN_PASSCODE` and `SUPABASE_SERVICE_ROLE_KEY` from the function environment; never expose either to the client. Body: `{ action, passcode, payload }`. Reject with 401 (constant-time compare) if the passcode is wrong. Otherwise use the service role key to perform the action:
> - `create_leaderboard {name}`: insert (name unique).
> - `rename_leaderboard {leaderboard_id, name}`.
> - `delete_leaderboard {leaderboard_id}`: delete (DB cascades players and games).
> - `add_player {leaderboard_id, name}`: insert (unique within the leaderboard).
> - `delete_player {player_id}`: if the player has 0 games, hard-delete; otherwise set `archived = true`. Decide server-side; return which happened.
> - `restore_player {player_id}`: set `archived = false`.
> - `log_game {leaderboard_id, game_date, p1, p2, p3, p4, loser}`: validate, before inserting, that `game_date` is not after today (use a caller-supplied timezone offset or an ISO date the client computed as local today, and reject anything greater); the four players are distinct, not archived, and all belong to `leaderboard_id`; and `loser` is one of them. Insert with that `leaderboard_id` and `game_date`.
> - `undo_last {leaderboard_id}`: delete the most recently created game in that leaderboard.
> - `edit_loser {game_id, loser}`: verify `loser` is one of that game's four players, then update.
> - `delete_game {game_id}`: delete.
> Validate payloads; on invalid input, future date, or constraint violation return 400 with a short message and no partial write. Restrict CORS to my site origin (env value). Log each write (action, leaderboard_id, ok/error, timestamp) via console for Supabase function logs.
> Write tests for: wrong passcode → 401; create_leaderboard then add_player then log_game happy path; log_game with a future date → 400; log_game with a player from another leaderboard → 400; log_game with a duplicate player → 400; delete_player with games → archived (not deleted); delete_player with no games → hard-deleted; edit_loser to a non-participant → 400. Show tests, then implementation.

**Acceptance criteria:**
- Wrong passcode never writes; neither secret reaches the client.
- Future dates, cross-leaderboard players, duplicate players, and non-participant losers are all rejected with no partial write.
- delete_player archives when there is history, hard-deletes when there is none.
- CORS limited to the site origin.

**Rollback:** delete/redeploy the function. No schema change.

---

## Epic 4 — Frontend: leaderboard switcher, standings read, table

**Goal:** anyone opens the URL, picks a leaderboard, and sees its live standings with both sorts and the legend.

**Depends on:** E1, E2.

**Claude Code prompt:**
> Build the read-only standings UI in `index.html`, `app.js`, `styles.css`. Load Supabase config from `config.js`. Add a leaderboard switcher (a dropdown or tabs) listing all leaderboards; remember the last selected one in `localStorage`. On load and on switch, fetch that leaderboard's `v_standings` rows and its games with the anon key, pass the standings rows through `ranking.js` `computeStandings`, and render a table: rank, name (mark archived players), GP, losses, games not lost, loss rate %. Add a sort toggle between "Most games not lost" and "Highest loss rate", default highest loss rate. Below the ranked table, show a "not enough games yet" group for provisional and gp=0 players, no rank. Style sub-25% loss-rate players as "beating luck" with a one-line legend: "A win is any game you did not lose. 25% is the loss rate of pure chance; lower is better." Show an error banner with a Reload button if a fetch fails. Mobile-first, readable at a card table. If there are no leaderboards yet, show an empty state telling the admin to unlock and create one.

**Acceptance criteria:**
- Switcher lists leaderboards; switching recomputes the whole view; last choice is remembered.
- Standings match `ranking.js` output; archived players show marked.
- Toggle switches order; default lowest loss rate; provisional group sits below; legend and luck line visible.
- Fetch error shows a banner. No-leaderboards state is handled.

**Rollback:** redeploy the previous build.

---

## Epic 5 — Frontend admin: leaderboard and player management, dated log flow

**Goal:** the admin can manage leaderboards and players in the UI and log a dated game by picking 4 of the active players, all passcode-gated.

**Depends on:** E3, E4.

**Claude Code prompt:**
> Add admin mode. An "Unlock" control asks for the passcode and keeps it in `sessionStorage` (never in the database, never in `localStorage`). Locked = read-only; unlocked = admin controls.
> Leaderboards: create (name), rename, and delete (confirm first, with an "export first?" reminder) via the `admin` Edge Function. After a change, refresh the switcher.
> Players (for the selected leaderboard): add a player (name), delete a player (calls `delete_player`; the server archives if they have games, hard-deletes if not; reflect the result), and restore an archived player. Show active and archived players separately.
> Log a game: a date field defaulting to today, using the device's local date, with future dates disabled (set the input's max to today). Then choose the 4 players who played: if the leaderboard has exactly 4 active players, pre-select them; if more than 4, the admin selects exactly 4; if fewer than 4 active players, disable logging with a message to add players. Then tap the 1 loser and Save (calls `log_game` with `leaderboard_id`, the chosen local `game_date`, the 4 player ids, and the loser). Target 3 taps in the common 4-active-player case. After save, show a "last game" card with Undo (`undo_last`). Also allow editing a past game's loser (`edit_loser`) and deleting a game (`delete_game`, confirm).
> After any successful write, re-fetch standings and games so the table and (later) the spotlights update. Block Save if the date is empty/future, if fewer or more than 4 players are chosen, or if no loser is marked. Show the server's error message on rejection and keep the last valid state.

**Acceptance criteria:**
- Locked = read-only; unlocked = full controls; passcode never persisted beyond the session or sent to the DB.
- Create/rename/delete leaderboard and add/delete/restore player all work and refresh the UI; delete of a player with games archives them.
- Date defaults to today and future dates are not selectable.
- With 4 active players, logging is 3 taps; with more than 4, the admin must pick exactly 4; with fewer than 4, logging is disabled.
- Undo, edit-loser, and delete-game work and refresh the view; a rejected write shows the message and changes nothing.

**Rollback:** redeploy the previous build; Supabase data untouched.

---

## Epic 6 — Loser spotlight (all-time + daily) and export

**Goal:** the two big loser cards above the table, and the export that is the offline backup.

**Depends on:** E2, E4, E5.

**Spec (PRD 14.4):** two cards above the standings, one name each, rendered clearly larger than the table rows; ties show all names; empty states handled.

**Claude Code prompt:**
> Add two things.
> (1) Loser spotlight: above the standings table, render two large cards for the selected leaderboard, "All-time biggest loser" and "Today's biggest loser". Use `ranking.js`: `biggestLoserAllTime` for all-time, and `biggestLoserForDate(games, players, todayLocalDateStr)` for today (today = the device's local date, matching how games were dated). Show the name(s) in type clearly larger than the standings rows (a clear size jump, e.g. a large display size vs the table's body size). Ties show every tied name. If today has no games, the today card shows "No games logged today". If the leaderboard has no games at all, both cards show "No data yet".
> (2) Export: an admin button that downloads the selected leaderboard's full game log and current standings as JSON (and CSV if easy), including each game's date, four players, and loser, so the standings can be rebuilt from it.
> The spotlight helpers are already unit-tested in E2; add a small render test or manual check that ties and empty states display correctly.

**Acceptance criteria:**
- All-time card shows the max-losses name(s); today card shows today's max-losses name(s); both handle ties and empty states.
- Spotlight names are visibly larger than the table rows.
- Export produces a complete file for the selected leaderboard; a quick manual check confirms standings could be rebuilt from it.

**Rollback:** redeploy the previous build.

---

## Epic 7 — Verification, security, and ship

**Goal:** prove the suite is strong, close the security surface, deploy, and confirm cross-device persistence.

**Depends on:** E1–E6.

**Claude Code prompt:**
> Do a verification and security pass before deploy.
> - Run all tests. Report any function written without a matching test, especially in the Edge Function.
> - No tautological tests: the ranking tests must fail if a tiebreak order is changed; the spotlight tests must fail if "most losses" is swapped for "fewest". Break each deliberately, confirm a red test, then revert.
> - Security: add an automated test that an anon-key insert into `games` is rejected; that a `log_game` with a future date is rejected; that neither `ADMIN_PASSCODE` nor the service role key appears in the frontend bundle or repo; that CORS on `admin` is limited to the site origin. Add a rate limit or short lockout on repeated bad passcodes.
> - Deploy the frontend to Netlify or Vercel, pointed at the prod Supabase project, and create the first prod leaderboard.
> - Give me a short runbook: rotate the passcode, export a leaderboard backup, roll back the frontend, and delete/rename a leaderboard.
> Then produce the reviewer's session summary (feature, checkpoints passed, verification debt, security surface, rollback, observability).

**Acceptance criteria (Checkpoint 5 — Verification + Security):**
```
[ ] No tautological tests (breaking a tiebreak or the loser rule turns a test red)
[ ] Error paths tested (bad passcode, future date, cross-leaderboard player, invalid payload, fetch error)
[ ] Untrusted input validated server-side (invariant, future date, same-leaderboard players)
[ ] Anon key proven read-only by an automated test
[ ] No secrets in the frontend or repo; passcode and service key only in function env
[ ] Bad-passcode rate limit / lockout in place
[ ] Failures observable (Edge Function logs each write)
[ ] Rollback documented (redeploy build; reversible migrations; undo/export; player archive; leaderboard confirm)
```

**The real ship test:** log a game on one phone; open the URL on a second device; switch to the same leaderboard; refresh; confirm the game and the updated spotlight appear.

**Rollback:** keep the previous static deploy one version back; the prod database is unaffected by a frontend rollback.

---

## Test vectors (shared, from PRD Appendix A + 14.4)

Reuse across E2, E4, E6, E7. One leaderboard, these games:

| Player | GP | Losses | Games not lost | Loss rate |
|---|---|---|---|---|
| Ade | 10 | 1 | 9 | 10% |
| Bima | 10 | 4 | 6 | 40% |
| Citra | 10 | 3 | 7 | 30% |
| Dewi | 10 | 2 | 8 | 20% |
| Eka | 2 | 0 | 2 | provisional (gp<5) |

- Most games not lost: Ade, Dewi, Citra, Bima, then Eka (2).
- Highest loss rate: Bima, Citra, Dewi, Ade ranked; Eka unranked.
- All-time biggest loser: Bima (4 losses). If Bima and Citra both had 4, the card shows both.
- Today's biggest loser: compute only from games whose `game_date` is today; if none are dated today, the card shows "No games logged today".

---

## What Claude Code should not decide for you

Per the reviewer, keep these human calls: approving this plan before the build, approving the final diff before deploy, deleting a leaderboard (irreversible cascade), and any change to a file that governs AI behavior (a CLAUDE.md or settings file). Read the diffs; do not let momentum replace judgment.
