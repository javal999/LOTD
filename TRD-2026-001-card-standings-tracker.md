> **⚠️ Partly superseded (2026-07-21).** v3 technical design for the card game (still live). The v4
> racquet additions (table tennis + padel) are additive migrations `0003`–`0006` plus new Edge
> Function actions and frontend, speced in [PRD-v4-multi-format-games.md](PRD-v4-multi-format-games.md)
> and proven by the `supabase/tests/*.sql` fixtures. The card design here is unchanged.

```yaml
doc_id: TRD-2026-001
doc_type: trd
project: card-standings-tracker
systems: [supabase-postgres, supabase-edge-functions, static-web-frontend, netlify-or-vercel]
vendors: [supabase, netlify]
status: draft
owner: levi
engineer_signoff: null
last_verified: 2026-07-14
supersedes: null
related: [PRD-card-game-standings-tracker.md, council-report-2026-07-14.html, BUILD-PLAN-card-standings-tracker.md]
```

# TRD — Card game standings tracker

Tier: **Full** (uses an external backend vendor, Supabase). Aligned to **PRD v3**: multiple leaderboards replace seasons, players are managed in the UI, games carry an admin-set date, and the leaderboard shows an all-time and a daily biggest-loser spotlight. Design claims are tagged `[A]` (AI-drafted, needs verification), `[S: doc]` (source-confirmed), or `[V: name]` (engineer-verified). This doc stays **Draft** until a builder verifies the design and signs.

## Basics

| Field | Value |
|---|---|
| Project | Card game standings tracker |
| Author | Levi (PM) |
| Engineer (signs Design) | *unassigned — Claude Code is the builder; a human must verify and sign before Approved* |
| Reviewers | The player group |
| Status | Draft |
| Date | 2026-07-14 |
| Related links | PRD-card-game-standings-tracker.md (v3) · BUILD-PLAN-card-standings-tracker.md · council-report-2026-07-14.html |

## Systems & terms

| Term | What it is |
|---|---|
| Supabase | Hosted Postgres database with auto-generated REST APIs, row-level security, and serverless Edge Functions. The shared data store. |
| Postgres | The relational database engine Supabase runs. Holds leaderboards, players, games. |
| RLS (row-level security) | Postgres feature that decides, per row and per role, who can read or write. Used to make the public API read-only. |
| Edge Function | A small serverless function hosted by Supabase. Holds the write secret and performs all admin writes. |
| anon key | Supabase's public API key, shipped in the browser. Safe to expose because RLS limits it to reads. |
| service role key | Supabase's admin API key that bypasses RLS. Lives only inside the Edge Function, never in the browser. |
| Static frontend | Plain HTML, CSS, and JavaScript with no server. Hosted on Netlify or Vercel. |
| Netlify / Vercel | Static hosting that serves the frontend at one shared URL. |
| Leaderboard | The top-level tracker. Each one has its own players, games, and standings. Replaces the v2 "season". |
| Admin | The single scorekeeper who logs results and manages players and leaderboards. Proven by a shared passcode, not an account. |
| Viewer | Anyone who opens the URL to read standings. No login. |
| Archived player | A player who has games but was removed. Kept in standings (marked archived), not offered for new games. |
| Spotlight | The two large cards above the table: all-time biggest loser and today's biggest loser. |
| GP / L | Games played / losses. Loss rate = L / GP. |

## 1. Summary

- **What are we building?** A shared web page that records results of a strictly-4-player card game (1 loser per game) across one or more leaderboards, and shows, per leaderboard, a live standings table plus a large all-time and daily biggest-loser spotlight. One admin logs results and manages players; everyone opens the same URL to read.
- **Why does it matter?** The group has no record of who wins or loses over time. The data has to survive a lost phone, be readable on any device, and let the group keep separate leaderboards for different games.
- **How will we know it worked?** Two numbers: logging a game takes under 10 seconds (PRD goal), and 0 lost-history incidents in a leaderboard's life (the reason for a shared store).

## 2. Background

- **How it works today:** nothing is recorded, or someone keeps a private note. A spreadsheet is too slow to update at the table and awkward to share.
- **Why now:** the group wants standings they can all open, separate leaderboards for different games, and a prominent "biggest loser" call-out. PRD v3 settled the model: a web app with cross-device persistence, single admin, no accounts, multiple leaderboards instead of seasons.

## 3. Goals & non-goals

We WILL: store every game in one shared Postgres store, scoped to a leaderboard; let the admin create, rename, and delete leaderboards and add, delete, and restore players in the UI; log a 4-player, 1-loser game with an admin-set date; show live standings with both sorts, a legend, the 25% luck line, and the two loser spotlights; keep viewers read-only on any device; export a leaderboard as backup.

We will NOT (this time): support any player count other than 4 per game (fixed model); add per-user accounts (a shared passcode is enough); add realtime push updates (refresh-on-open is enough for v1, realtime is Phase 2); track money; share one game across multiple leaderboards (a game belongs to exactly one).

## 4. Requirements

What it must do: create and switch leaderboards; add, delete (archive if they have games), and restore players; log a game by picking 4 of the leaderboard's active players and marking 1 loser, on a date that defaults to today and cannot be in the future; enforce the invariant (exactly 4 distinct players, exactly 1 loser who was at the table) on create and edit; compute GP, losses, games not lost, loss rate, rank per leaderboard; rank by games-not-lost and by loss rate with a 5-game threshold; show the all-time and today biggest-loser spotlights; undo the last game; export a leaderboard.

Also make sure it handles:
- **Speed:** standings read under about 1 second; the dataset is tiny (hundreds of games per leaderboard). `[A]`
- **Scale:** one group, a handful of leaderboards, roughly 4 to 8 players each, well within Supabase's free tier. `[S: Supabase docs]`
- **Security/privacy:** only first names stored, no PII of concern. Writes must be impossible from the public key; a leaked URL must not let anyone corrupt data. `[A]`

## 5. Design

*Every technical claim carries a provenance tag. No `[A]` may remain at Approved status.*

Picture it:

```
  Viewer's phone                 Admin's phone
        |                             |
     (read)                    (write, +passcode)
        |                             |
        v                             v
  supabase-js  --------->  Supabase Edge Function "admin"
  (anon key,               (checks passcode, holds
   read-only via RLS)       service role key)
        |                             |
        |     both hit the same       |
        v                             v
        +--------> Supabase Postgres <---------+
           leaderboards · players · games
           v_standings (view, scoped by leaderboard)
```

Walk through it: `[A]`
- Anyone opens the static site and selects a leaderboard. It reads that leaderboard's standings and games with the public anon key. RLS allows SELECT only, so a viewer cannot write. `[S: Supabase docs]` for RLS behavior.
- The all-time and daily biggest-loser spotlights are computed in the browser from the selected leaderboard's games, so "today" is the viewer's local date. `[A]`
- To write (log a game, manage players or leaderboards), the admin unlocks with a passcode held in the browser session, then the frontend calls the `admin` Edge Function passing that passcode. The function checks it, then writes with the service role key. The browser never holds a write secret. `[A]`
- Standings are a Postgres view aggregating games per leaderboard. The frontend applies the threshold, tiebreakers, and rank in JavaScript so that logic is unit-testable without a database. `[A]`

Data we store:

| Table.field | Example | Notes |
|---|---|---|
| leaderboards.name | "Poker night" | Unique. Top-level container. Replaces seasons. |
| players.leaderboard_id | 1 | Player belongs to one leaderboard. |
| players.name | "Ade" | Unique within a leaderboard. |
| players.archived | false | True = kept in standings, not offered for new games. |
| games.leaderboard_id | 1 | Game belongs to one leaderboard. |
| games.game_date | 2026-07-14 | Admin-set date, defaults to today, never in the future. Drives the daily spotlight. |
| games.p1..p4 | player ids | Four NOT NULL columns force exactly 4 players. |
| games.loser | player id | One column forces exactly 1 loser. |

The invariant is enforced by the schema, which closes the council's "illegal edit" hole: `[A]`
- Four separate NOT NULL player columns make "not 4 players" unrepresentable.
- One `loser` column makes "2 losers" unrepresentable.
- `CHECK (loser IN (p1,p2,p3,p4))` and a distinct-players CHECK reject a loser who was not at the table or a repeated player, on both insert and update.
- `games.p1..p4` reference `players(id)` with ON DELETE RESTRICT, so a player who has games cannot be hard-deleted; the admin archives them instead. `[A]`
- `players` and `games` reference `leaderboards(id)` with ON DELETE CASCADE, so deleting a leaderboard removes its players and games in one step. `[A]`
- Future-date guard: the Edge Function rejects any `game_date` after the admin's local today. A loose DB `CHECK (game_date <= current_date + 1)` catches gross errors while allowing timezone slack. `[A]`

Interfaces/APIs:
- Read: `GET` on `v_standings` (filtered by `leaderboard_id`), `games`, `players`, and `leaderboards` via Supabase REST, anon key, RLS read-only. `[S: Supabase docs]`
- Write: `POST` to Edge Function `admin` with `{ action, passcode, payload }`. Actions: `create_leaderboard | rename_leaderboard | delete_leaderboard | add_player | delete_player | restore_player | log_game | undo_last | edit_loser | delete_game`. `[A]`

Edge cases we handle (full list in PRD sections 8 and 14):
- Save blocked if the 4 players are not chosen, no loser, or more than 1 loser (UI plus DB CHECK). `[A]`
- Loss rate never divides by zero: players with 0 games show a dash and are unranked. `[A]`
- Under 5 games: shown in "not enough games yet", unranked in loss-rate mode. `[A]`
- Delete a player with games: archived, not deleted; still in standings, not selectable for new games. `[A]`
- Fewer than 4 active players: logging disabled with a message. `[A]`
- Future `game_date`: rejected. Backdated game counts toward its own date's daily spotlight. `[A]`
- Spotlight ties: all tied names shown. No games today: daily card shows an empty message. `[A]`
- Concurrent devices: only the admin writes; viewers are read-only, so last admin write wins with no merge conflict. `[A]`

## 5b. Integration & responsibility

| Interface | From → To | Owner (build) | Owner (run) | Who fixes it when it breaks | Failure behavior |
|---|---|---|---|---|---|
| Read standings / spotlights | Frontend → Supabase REST | Claude Code | Supabase (managed) | Levi (config) | Page shows last successful load or an error banner; no data loss |
| Admin write | Frontend → Edge Function → Postgres | Claude Code | Supabase (managed) | Levi (rotate passcode/keys) | Write rejected; UI keeps the last valid state; nothing partial committed |
| Static hosting | Browser → Netlify/Vercel | Claude Code | Netlify/Vercel (managed) | Levi (redeploy) | Old build still served; data in Supabase unaffected |

## 5c. Data contracts

Edge Function `admin` request: JSON `{ action, passcode, payload }`. Response: `{ ok, data?, error? }`. `[A]`

Leaderboard actions:
- `create_leaderboard` `{ name }` → creates a leaderboard (name unique).
- `rename_leaderboard` `{ leaderboard_id, name }`.
- `delete_leaderboard` `{ leaderboard_id }` → cascades to its players and games. Confirm in UI first.

Player actions:
- `add_player` `{ leaderboard_id, name }` → name unique within the leaderboard.
- `delete_player` `{ player_id }` → if the player has 0 games, hard-delete; otherwise set `archived = true`. The function decides, not the client.
- `restore_player` `{ player_id }` → `archived = false` (P1).

Game actions:
- `log_game` `{ leaderboard_id, game_date, p1, p2, p3, p4, loser }` → server re-validates: game_date not in the future; the 4 players are distinct, active, and all belong to `leaderboard_id`; `loser` is one of them. Then insert.
- `edit_loser` `{ game_id, loser }` → loser must be one of that game's four players.
- `undo_last` `{ leaderboard_id }` → delete the most recently created game in that leaderboard.
- `delete_game` `{ game_id }`.

Rejects: bad passcode → 401; invalid payload, future date, or invariant violation → 400 with a message; the client shows the message and changes nothing. `[A]`

## 5d. Failure modes & observability

- **Bad passcode / brute force:** the function returns 401. Add a simple per-IP rate limit or short lockout. `[OPEN — confirm rate-limit approach — Levi/builder — before launch]`
- **Supabase outage:** reads and writes fail; the page shows an error banner and the admin retries later. Managed uptime, no on-call. `[A]`
- **Wrong data entry (wrong loser or wrong date):** caught socially and fixed with undo, edit, or delete. No automated reconciliation in v1 (PRD section 9). `[A]`
- **Observability:** the Edge Function logs each write (action, leaderboard, result, timestamp) to Supabase function logs; that is the audit trail. `[S: Supabase docs]`

## 6. Other options considered

- **Picked — Supabase + static vanilla JS:** one managed store gives cross-device persistence and read-only public access via RLS with almost no backend code; vanilla JS keeps the app tiny, which the council pushed for. The standings table and the two text spotlights need no chart library. `[A]`
- **Skipped — single HTML file with localStorage:** simplest to build but fails the core requirement; data lives on one device and dies with it. `[A]`
- **Skipped — Firebase + React:** realtime is nearly free, but it ties us to Firestore's model and adds a build step and framework for a small scoreboard. `[A]`
- **Skipped — client-side-only passcode:** dead simple, but a technical friend could read the anon key and write directly, so it is not real protection. `[A]`

## 7. How it ships & how we undo it

- **Rollout:** build against a Supabase dev project, seed one leaderboard and its 4 players, test with the group for a week, then point the site at a prod project. No existing users to migrate. `[A]`
- **Testing:** unit tests for ranking, tiebreak, threshold, loss-rate math, and both spotlight helpers (pure JS, no DB); integration tests that a `log_game` writes correct rows, that an anon-key write is rejected, that a future date is rejected, and that deleting a player with games archives rather than deletes; a manual 2-device check that a game logged on one phone shows on another after refresh. `[A]`
- **Rollback:** redeploy the previous static build to undo a frontend change; data in Supabase is untouched. Schema changes ship as reversible migrations. In-app recovery: undo-last, export, and (for players) archive give layers before anything is truly lost. `[A]`

## 7b. Environments & cutover

Two Supabase projects: dev and prod. Frontend reads `SUPABASE_URL` and anon key from build config per environment. Cutover is a one-line config switch plus creating the first leaderboard in prod. No vendor coordination needed. `[A]`

## 8. Risks

| Risk | Plan |
|---|---|
| Passcode leaks or is brute-forced | Real server-side check, rate limit, rotatable passcode; export as backup if someone tampers. `[A]` |
| Admin forgets to log games (council's top human risk) | Keep logging fast; the daily spotlight surfaces a missed night; admin can backdate. No auto-reconciliation. `[A]` |
| Anon key misused | RLS denies all writes to anon; verified by a test that an anon insert fails. `[A]` |
| Accidental leaderboard delete | Confirm step and an export reminder; cascade is intentional but irreversible, so the reminder matters. `[A]` |
| Deleting a player destroys history | The function archives players who have games; only game-free players are hard-deleted; FK RESTRICT is the backstop. `[A]` |
| Two sorts redundant for this group | Ship both, but the PRD open question asks the group how often the lineup changes. `[A]` |
| Free-tier limits | Dataset is tiny; well under Supabase and Netlify free limits. `[S: Supabase docs]` |

## 9. Plan & timeline

See the companion build plan (BUILD-PLAN-card-standings-tracker.md) for the epic-by-epic sequence and Claude Code prompts.

| Milestone | What's done by then | Owner | Target date |
|---|---|---|---|
| M1 Schema live | leaderboards, players (archived), games (game_date), constraints, view, RLS, seed in Supabase dev | Claude Code | TBD |
| M2 Write path | `admin` Edge Function with passcode + all 10 actions, tests pass | Claude Code | TBD |
| M3 Read UI | Leaderboard switcher, standings, both sorts, legend, luck line | Claude Code | TBD |
| M4 Admin + spotlight | Leaderboard and player management, dated log flow (pick 4 of N), undo/edit/delete, all-time + daily spotlight, export | Claude Code | TBD |
| M5 Ship | Security + verification gate passed, deployed, 2-device check | Claude Code + Levi | TBD |

## 10. Open questions

- [OPEN — Do you need both sorts, or just loss rate? Ask the players how often the lineup changes — Levi — before M3]
- RESOLVED (2026-07-14, Levi): all-time biggest loser is by total (accumulative) losses. Ties render every tied name in the card; no extra logic.
- [OPEN — Rate-limit / lockout approach for the passcode on the Edge Function — Levi/builder — before M5]
- [OPEN — Netlify vs Vercel for hosting (either works) — Levi — before M5]
- [OPEN — Who is the human that verifies the design and signs this TRD, moving it to Approved — Levi — before M1]

---

## Appendix — Vibe-code-reviewer checkpoints (planning phase)

Run at design time, before any code. These gate the build.

```
CHECKPOINT 1: ARCHITECTURE
[PASS]  Complexity justified for scope? Yes. One managed DB, one small function, static frontend. No framework, no chart library.
[PASS]  External dependencies minimal and known-safe? Supabase + a static host. Both managed, free tier, widely used.
[PASS]  Error surface identified? Bad passcode, invalid payload, future date, DB constraint violation, Supabase outage, stale read. Listed in 5d and 5.
[PASS]  Rollback strategy defined? Redeploy previous static build; reversible migrations; undo/archive/export in-app. Data persists in Supabase.
[PASS]  Testable in isolation? Ranking, threshold, tiebreak, and spotlight math are pure JS, unit-testable with no DB.
Blocker: none
```

```
CHECKPOINT 2: SPECIFICATION
[PASS]  Every action has a signature and error semantics? Yes. 10 Edge Function actions defined in 5c with payloads and reject codes.
[PASS]  Data model has constraints and invariants stated? Yes. 4 player columns, 1 loser column, CHECKs, FK RESTRICT/CASCADE, future-date guard.
[PASS]  Examples hand-computed? Yes. PRD Appendix A plus the spotlight vectors in the build plan.
[PASS]  Spec specific enough to test without reading code? Yes. Ranking, tiebreaks, threshold, archive rule, and spotlight rules are fully specified.
Blocker: none. One [OPEN] on rate-limiting is a hardening detail carried to M5. The all-time-loser metric is settled: total (accumulative) losses.
```

Two human decisions the reviewer flags as not-to-automate: a person must approve this spec before implementation, and a person must read and approve the final diff before it goes live.
