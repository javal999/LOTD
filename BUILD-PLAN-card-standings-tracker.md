# Build plan — Card game standings tracker

**Companion to:** TRD-2026-001-card-standings-tracker.md and PRD-card-game-standings-tracker.md (v2)
**Stack:** Supabase (Postgres + Edge Functions) + vanilla JS static frontend, hosted on Netlify or Vercel
**For:** building with Claude Code, epic by epic
**Date:** 2026-07-14

---

## How to use this

Build in order. Each epic is one Claude Code session. Copy the prompt block into Claude Code, let it work, then check it against the acceptance criteria and run the tests before moving on. The epics follow the vibe-code-reviewer phase gates: spec is set (the TRD), tests come before implementation, and the last epic is the security and verification gate.

Two things only a human should do, per the reviewer: approve this plan before Claude Code starts, and read the final diff before you deploy. Do not rubber-stamp.

**Dependency order:**

```
E0 scaffold ─► E1 schema ─► E2 ranking lib ─┬─► E4 read UI ─► E5 admin UI ─► E6 extras ─► E7 ship
                            └─► E3 edge fn ──┘
```

E2 (pure ranking logic) and E3 (write path) can be built in either order after E1. Everything else is linear.

---

## Epic 0 — Repo scaffold and Supabase project

**Goal:** an empty, deployable skeleton and a Supabase dev project wired up.

**Depends on:** nothing.

**Claude Code prompt:**
> Create a minimal static web project for a card game standings tracker. No framework, no build step: `index.html`, `app.js`, `styles.css`, plus a `supabase/` folder for migrations and Edge Functions. Add a `README.md` documenting local run (open index.html or `npx serve`) and the two environment values the frontend needs at runtime: `SUPABASE_URL` and `SUPABASE_ANON_KEY`, loaded from a `config.js` that is gitignored. Add a `.gitignore` covering `config.js`, `.env`, and `node_modules`. Do not hardcode any keys. Initialize the Supabase CLI project structure under `supabase/`. Stop and show me the file tree before writing any feature code.

**Acceptance criteria:**
- File tree exists; `index.html` loads locally with no errors.
- No secrets committed; `config.js` is gitignored and has a `config.example.js` template.
- `supabase/` is initialized for migrations and functions.

**Tests:** none yet (scaffold). Confirm the page opens and the console is clean.

**Rollback:** delete the folder. Nothing external created yet.

---

## Epic 1 — Database schema, constraints, view, RLS, seed

**Goal:** the shared data model with the invariant enforced in the database, public read-only access, and the 4 players seeded.

**Depends on:** E0.

**Spec (from the TRD):** three tables (`players`, `seasons`, `games`), one aggregation view (`v_standings`), RLS that allows anon SELECT and denies anon writes.

**Claude Code prompt:**
> Write a Supabase SQL migration under `supabase/migrations/` for a card game standings tracker. Requirements, exactly:
> - `players(id bigint identity pk, name text not null unique, active boolean not null default true, created_at timestamptz default now())`.
> - `seasons(id bigint identity pk, name text not null, started_at timestamptz not null default now(), ended_at timestamptz, is_active boolean not null default true)`. Add a partial unique index so at most one season has `is_active = true`.
> - `games(id bigint identity pk, season_id bigint not null references seasons(id), played_at timestamptz not null default now(), p1 bigint not null references players(id), p2 ... p3 ... p4 bigint not null references players(id), loser bigint not null references players(id), created_at timestamptz default now())`.
> - On `games`, add `CHECK` constraints: all four of p1,p2,p3,p4 are distinct; and `loser IN (p1,p2,p3,p4)`. These enforce "exactly 4 distinct players, exactly 1 loser who was at the table" at the database level.
> - Create view `v_standings` for the active season: for every player, `gp` = number of games they were in (any of p1..p4), and `losses` = number of games where they were the loser. Do not compute loss rate or rank in SQL; the frontend does that.
> - Enable RLS on all three tables. Add policies so the `anon` role can `SELECT` on players, seasons, games, and can read `v_standings`. Add no anon INSERT/UPDATE/DELETE policies (writes stay denied for anon).
> - A seed migration inserting one active season "Season 1" and four players (use placeholder names Player1..Player4 I can rename).
> Show me the SQL before applying it. Then tell me exactly how to apply it to my Supabase dev project.

**Acceptance criteria:**
- Migration applies cleanly to a fresh Supabase project.
- Inserting a game with a repeated player, or a `loser` not among p1..p4, is rejected by the DB.
- Only one season can be active.
- With the anon key, a SELECT on `v_standings` returns rows; an INSERT into `games` is rejected.

**Tests (run against the dev project):**
1. Insert a valid game → succeeds.
2. Insert a game with p1 = p2 → rejected (distinct CHECK).
3. Insert a game with loser = some player not in p1..p4 → rejected.
4. Set a second season `is_active = true` → rejected by the partial unique index.
5. Anon-key INSERT into `games` → rejected by RLS. Anon-key SELECT on `v_standings` → allowed.

**Rollback:** `down` migration drops the view and tables. Data is dev-only at this stage.

---

## Epic 2 — Ranking library (pure JavaScript, test-first)

**Goal:** the standings math the whole app depends on, as a pure module with no database, so it is fully unit-testable. This is the highest-value code to get right.

**Depends on:** E1 (for the shape of the input rows).

**Spec (from PRD section 2 and 7.5):** input is an array of `{ name, gp, losses }`. Output is a ranked list with `games_not_lost = gp - losses`, `loss_rate = losses/gp` (or null if gp = 0), a `provisional` flag when `gp < 5`, and a `rank` per the chosen sort with the tiebreakers below.

**Write the tests first.** Use these hand-computed vectors from the PRD:

Input (all played 10):
```
Ade   gp10 l1   Bima gp10 l4   Citra gp10 l3   Dewi gp10 l2
```
- Sort "most games not lost" → Ade(9), Dewi(8), Citra(7), Bima(6).
- Sort "lowest loss rate" → Ade(10%), Dewi(20%), Citra(30%), Bima(40%).
- Add Eka gp2 l0: in "most games not lost" Eka ranks last (2 not-lost). In "lowest loss rate" Eka is `provisional` (gp<5), listed below the ranked four, no rank, not position 1 on 0%.

**Claude Code prompt:**
> First write a test file for a pure ranking module `ranking.js`, then implement it to pass. Do not write the implementation before the tests. The module exports `computeStandings(rows, mode)` where `rows` is `[{name, gp, losses}]` and `mode` is `"most_not_lost"` or `"lowest_loss_rate"`.
> Rules:
> - `games_not_lost = gp - losses`; `loss_rate = losses / gp`, or `null` when `gp === 0`.
> - A player with `gp < 5` is `provisional: true`.
> - Mode `most_not_lost`: rank all players by games_not_lost descending. Tiebreak: lower loss_rate, then more gp, then name A→Z.
> - Mode `lowest_loss_rate`: rank only non-provisional players by loss_rate ascending. Tiebreak: more gp, then more games_not_lost, then name A→Z. Provisional players (and gp=0) are returned in a separate `unranked` list with no rank.
> - Output: `{ ranked: [...with rank 1..n], unranked: [...] }`.
> Cover these cases as tests: the 4-player equal-GP vectors I give you (both modes), the Eka provisional case (both modes), a gp=0 player (unranked, loss_rate null, no divide-by-zero), and a tie broken by each tiebreak level. Then implement and make all tests green. Show me the failing tests first, then the passing run.

**Acceptance criteria:**
- Tests are written before the implementation and fail first (no tautological tests).
- All vectors above pass. No divide-by-zero. Provisional players never take a loss-rate rank.

**Tests:** the vectors above, plus each tiebreak level, plus gp=0.

**Rollback:** revert the two files. Pure code, no side effects.

---

## Epic 3 — Admin write Edge Function (passcode-gated)

**Goal:** the only write path. Holds the write secret server-side so the public site can never corrupt data.

**Depends on:** E1.

**Spec (from TRD 5c):** `POST` `{ action, passcode, payload }`; actions `log_game | undo_last | edit_loser | delete_game | start_season`; returns `{ ok, data?, error? }`.

**Claude Code prompt:**
> Write a Supabase Edge Function named `admin` (Deno/TypeScript) that is the only way to write data. It reads two secrets from the function environment: `ADMIN_PASSCODE` and `SUPABASE_SERVICE_ROLE_KEY` (never expose either to the client). Request body: `{ action, passcode, payload }`.
> - Reject with 401 if `passcode` does not match `ADMIN_PASSCODE`. Use a constant-time comparison.
> - Otherwise use the service role key (a Supabase client) to perform the action against the active season:
>   - `log_game`: payload `{ p1, p2, p3, p4, loser }`. Re-validate that the four players are distinct and `loser` is one of them BEFORE inserting (defense in depth; the DB also enforces it). Insert into `games` with the active `season_id`.
>   - `undo_last`: delete the most recently created game in the active season.
>   - `edit_loser`: payload `{ game_id, loser }`. Verify `loser` is one of that game's four players, then update.
>   - `delete_game`: payload `{ game_id }`. Delete it.
>   - `start_season`: payload `{ name }`. Set the current active season `is_active=false, ended_at=now()`, then insert a new active season.
> - Validate payloads; on invalid input or a constraint violation return 400 with a short message. Never return a partial success.
> - Restrict CORS to my site origin (make the origin an env value).
> - Log each write (action, ok/error, timestamp) via `console.log` so it appears in Supabase function logs.
> Write tests for: wrong passcode → 401; valid log_game → row inserted; log_game with a duplicate player → 400 and nothing inserted; edit_loser to a player not in the game → 400; start_season deactivates the old season and creates exactly one active season. Show the tests, then the implementation.

**Acceptance criteria:**
- Wrong passcode never writes. Neither secret is ever sent to the client.
- Every action works and every invalid input returns 400 with no partial write.
- CORS limited to the site origin.

**Tests:** the five listed in the prompt, run against the dev project.

**Rollback:** delete the function (Supabase keeps the previous deployed version until you redeploy). No schema change.

---

## Epic 4 — Frontend: standings read and table

**Goal:** anyone opens the URL and sees the live standings with both sorts and the legend.

**Depends on:** E1, E2.

**Claude Code prompt:**
> Build the read-only standings UI in `index.html`, `app.js`, `styles.css`. Load Supabase config from `config.js` (gitignored). On load, fetch `v_standings` with the anon key, pass the rows through `ranking.js` (`computeStandings`), and render a table: rank, name, GP, losses, games not lost, loss rate %. Add a sort toggle between "Most games not lost" and "Lowest loss rate"; default to lowest loss rate. Below the ranked table, show an "not enough games yet" group for provisional and gp=0 players with their raw numbers and no rank. Style players under 25% loss rate as "beating luck" and include a one-line legend: "A win is any game you did not lose. 25% is the loss rate of pure chance; lower is better." Show a clear error banner if the fetch fails, and a "Reload" button. Mobile-first layout; readable at arm's length at a card table.

**Acceptance criteria:**
- Standings match `ranking.js` output exactly (no separate math in the UI).
- Toggle switches order; default is lowest loss rate.
- Provisional players sit below, unranked. Legend and luck line are visible and explained.
- A failed fetch shows a banner, not a blank page.

**Tests:** render with a seeded set of games and confirm the order matches the E2 vectors; simulate a fetch error and confirm the banner shows.

**Rollback:** redeploy the previous static build.

---

## Epic 5 — Frontend: admin log flow

**Goal:** the 3-tap logging the whole product is judged on, plus undo, edit, delete, and season reset, all gated by the passcode.

**Depends on:** E3, E4.

**Claude Code prompt:**
> Add an admin mode to the frontend. An "Unlock" control asks for the passcode and keeps it in memory for the session (sessionStorage, not localStorage; never write it to the database). While unlocked, show admin controls; while locked, the page is read-only.
> - Log a game: the four seeded players are pre-selected; the admin taps the one loser and taps Save. Saving calls the `admin` Edge Function `log_game` with the passcode. Target: 3 taps, under 10 seconds. After save, show a "last game" card with an Undo button that calls `undo_last`.
> - Edit: from a game log list, change the loser (calls `edit_loser`) or delete a game (calls `delete_game`, with a confirm).
> - Season: a "Start new season" button (confirm first) calls `start_season`.
> - After any successful write, re-fetch standings so the table updates. Block Save if no loser is selected. Show the server's error message if a write is rejected, and keep the last valid state.

**Acceptance criteria:**
- Locked = read-only; unlocked = full controls. Passcode never persisted to storage that outlives the session, never sent to the database.
- Logging a game is 3 taps and updates the standings on success.
- Undo, edit, delete, and season reset all work and refresh the table.
- A rejected write shows the message and changes nothing on screen.

**Tests:** log a game and confirm the row and standings update; undo and confirm reversal; attempt Save with no loser and confirm it is blocked; enter a wrong passcode and confirm no write.

**Rollback:** redeploy the previous static build; data in Supabase is untouched.

---

## Epic 6 — Loser of the night, export, backup

**Goal:** the one delight hook the council kept, plus the export that is the offline backup.

**Depends on:** E4, E5.

**Claude Code prompt:**
> Add two features. (1) "Loser of the night": from today's games (same calendar day, or a session the admin starts), compute and show who lost the most, e.g. "Tonight's biggest loser: Bima (3)". Pure client-side from the games already fetched; reuse or extend `ranking.js` with a tested helper. (2) Export: an admin button that downloads the full game log and current standings as a JSON file (and CSV if easy), containing every game's timestamp, four players, and loser, so the standings can be rebuilt from it. Write a unit test for the "loser of the night" helper with a hand-made set of today's games.

**Acceptance criteria:**
- "Loser of the night" is correct for a known set of today's games and hidden when there are none today.
- Export produces a complete file; a quick manual check confirms the standings could be rebuilt from it.

**Tests:** unit test the loser-of-the-night helper; manually open an export file and confirm every logged game is present.

**Rollback:** redeploy the previous build. Export is read-only.

---

## Epic 7 — Verification, security, and ship

**Goal:** prove the suite is strong, close the security surface, deploy, and confirm cross-device persistence for real.

**Depends on:** E1–E6.

**Claude Code prompt:**
> Do a verification and security pass before deploy.
> - Run all tests. Report any function written without a matching test (verification debt), especially in the Edge Function.
> - Confirm no tautological tests: the ranking tests must fail if the tiebreak order is changed. Deliberately break a tiebreak and confirm a test goes red, then revert.
> - Security: confirm the anon key can only read (add an automated test that an anon-key insert into `games` is rejected). Confirm neither `ADMIN_PASSCODE` nor the service role key appears anywhere in the frontend bundle or the repo. Confirm CORS on the `admin` function is limited to the site origin. Add a simple rate limit or short lockout on repeated bad passcodes.
> - Deploy the frontend to Netlify or Vercel and point it at the prod Supabase project with a fresh Season 1.
> - Give me a short runbook: how to rotate the passcode, how to export a backup, how to roll back the frontend.
> Then produce the reviewer's session summary (feature, checkpoints passed, verification debt, security surface, rollback, observability).

**Acceptance criteria (Checkpoint 5 — Verification + Security):**
```
[ ] No tautological tests (breaking a tiebreak turns a test red)
[ ] Error paths tested, not just happy paths (bad passcode, invalid payload, fetch error)
[ ] Untrusted input identified and validated (Edge Function re-checks the invariant)
[ ] Anon key proven read-only by an automated test
[ ] No secrets in the frontend or repo; passcode and service key only in function env
[ ] Bad-passcode rate limit / lockout in place
[ ] Failures observable (Edge Function logs each write)
[ ] Rollback documented (redeploy build; reversible migrations; undo/archive/export)
```

**The real ship test:** log a game on one phone; open the URL on a second device; refresh; confirm the game appears. This is the whole reason for the shared store.

**Rollback:** keep the previous static deploy one version back; the prod database is unaffected by a frontend rollback.

---

## Test vectors (shared, from PRD Appendix A)

Reuse these across E2, E4, and E7.

| Player | GP | Losses | Games not lost | Loss rate |
|---|---|---|---|---|
| Ade | 10 | 1 | 9 | 10% |
| Bima | 10 | 4 | 6 | 40% |
| Citra | 10 | 3 | 7 | 30% |
| Dewi | 10 | 2 | 8 | 20% |
| Eka | 2 | 0 | 2 | provisional (gp<5) |

- Most games not lost: Ade, Dewi, Citra, Bima, then Eka (2, ranks last).
- Lowest loss rate: Ade, Dewi, Citra, Bima ranked; Eka unranked (provisional).
- Losses sum to 10 across the first four, one loser per game.

---

## What Claude Code should not decide for you

Per the reviewer, keep these three as human calls: approving this plan before the build, approving the final diff before deploy, and any change to a file that governs AI behavior (a CLAUDE.md or settings file). Read the diffs; do not let momentum replace judgment.
