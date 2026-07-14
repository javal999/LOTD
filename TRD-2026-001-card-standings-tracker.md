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
related: [PRD-card-game-standings-tracker.md, council-report-2026-07-14.html]
```

# TRD — Card game standings tracker

Tier: **Full** (uses an external backend vendor, Supabase). Design claims are tagged `[A]` (AI-drafted, needs verification), `[S: doc]` (source-confirmed), or `[V: name]` (engineer-verified). This doc stays **Draft** until a builder verifies the design and signs. No engineer has signed, so no claim here is `[V]` yet.

## Basics

| Field | Value |
|---|---|
| Project | Card game standings tracker |
| Author | Levi (PM) |
| Engineer (signs Design) | *unassigned — Claude Code is the builder; a human must verify and sign before Approved* |
| Reviewers | The 4-player group |
| Status | Draft |
| Date | 2026-07-14 |
| Related links | PRD-card-game-standings-tracker.md (v2) · council-report-2026-07-14.html |

## Systems & terms

| Term | What it is |
|---|---|
| Supabase | Hosted Postgres database with auto-generated REST APIs, row-level security, and serverless Edge Functions. The shared data store. |
| Postgres | The relational database engine Supabase runs. Holds players, games, seasons. |
| RLS (row-level security) | Postgres feature that decides, per row and per role, who can read or write. Used to make the public API read-only. |
| Edge Function | A small serverless function hosted by Supabase. Holds the write secret and performs all admin writes. |
| anon key | Supabase's public API key, shipped in the browser. Safe to expose because RLS limits it to reads. |
| service role key | Supabase's admin API key that bypasses RLS. Lives only inside the Edge Function, never in the browser. |
| Static frontend | Plain HTML, CSS, and JavaScript with no server. Hosted on Netlify or Vercel. |
| Netlify / Vercel | Static hosting that serves the frontend at one shared URL. |
| Admin | The single scorekeeper who logs results. Proven by a shared passcode, not an account. |
| Viewer | Anyone who opens the URL to read standings. No login. |
| GP / L | Games played / losses. Loss rate = L / GP. |

## 1. Summary

- **What are we building?** A shared web page that records results of a strictly-4-player card game (1 loser per game) and shows a live standings table, sortable by games not lost and by loss rate. One admin logs results; everyone opens the same URL to read.
- **Why does it matter?** The group has no record of who wins or loses over time. The data has to survive a lost phone and be readable on any device, which a single-device app cannot do.
- **How will we know it worked?** Two numbers: logging a game takes under 10 seconds (from the PRD goal), and 0 lost-history incidents in a season (the reason for a shared store).

## 2. Background

- **How it works today:** nothing is recorded, or someone keeps a note that others cannot see. A spreadsheet is too slow to update at the table and awkward to share.
- **Why now:** the group wants standings they can all open, and the PRD (v2) resolved the key constraint: a web app with cross-device persistence, single admin, no accounts.

## 3. Goals & non-goals

We WILL: store every game in one shared Postgres store; show live standings with both sorts, a legend, and the 25% luck line; let one passcode-holding admin log, undo, edit, delete, reset a season, and export; keep viewers read-only on any device.

We will NOT (this time): support any player count other than 4 (fixed model, not a later phase); add per-user accounts (a shared passcode is enough); add realtime push updates (refresh-on-open is enough for v1, realtime is Phase 2); track money.

## 4. Requirements

What it must do: log a 4-player, 1-loser game in 3 taps; enforce the invariant (exactly 4 distinct players, exactly 1 loser) on create and edit; compute GP, losses, games not lost, loss rate, rank; rank by games-not-lost and by loss rate with a 5-game threshold; undo the last game; export the full log; start a new season; show tonight's biggest loser.

Also make sure it handles:
- **Speed:** standings read under about 1 second; the dataset is tiny (hundreds of games per season). `[A]`
- **Scale:** one group, roughly 4 to 8 players, well within Supabase's free tier. `[S: Supabase docs]`
- **Security/privacy:** only first names stored, no PII of concern. Writes must be impossible from the public key; a leaked URL must not let anyone corrupt data. `[A]`

## 5. Design

*Every technical claim carries a provenance tag. No `[A]` may remain at Approved status.*

Picture it:

```
  Viewer's phone            Admin's phone
        |                        |
     (read)                 (write, +passcode)
        |                        |
        v                        v
  supabase-js  ------->  Supabase Edge Function "admin"
  (anon key,             (checks passcode, holds
   read-only via RLS)     service role key)
        |                        |
        |    both hit the same   |
        v                        v
        +----> Supabase Postgres <----+
               players · games · seasons
               (GP/L tallied in the browser)
```

Walk through it: `[A]`
- Anyone opens the static site. It reads standings with the public anon key. RLS allows SELECT only, so a viewer cannot write. `[S: Supabase docs]` for RLS behavior.
- To log a game, the admin unlocks with a passcode held in the browser session, then the frontend calls the `admin` Edge Function passing that passcode. The function checks it, then writes with the service role key. The browser never holds a write secret. `[A]`
- Standings are computed in the browser: a tested `tally()` aggregates the games log into per-player GP/L, then the ranking library applies the threshold, tiebreakers, and rank. All derived-stat logic is pure JS, unit-tested without a database (25 tests green). `[V: built 2026-07-14]` The frontend already loads the full games log (for export + loser-of-the-night), so tallying in JS is one tested source of truth and removes the `v_standings` view from the design.

Data we store:

| Field | Example | Notes |
|---|---|---|
| players.name | "Ade" | Unique. v1 seeds the fixed 4. |
| seasons.name, is_active | "Season 1", true | Exactly one active season at a time. |
| games.played_at | 2026-07-14T21:03Z | Auto timestamp, used for undo and "loser of the night". |
| games.p1..p4 | player ids | Four NOT NULL columns force exactly 4 players. |
| games.loser | player id | One column forces exactly 1 loser. |

The invariant is enforced by the schema, which is what closes the council's "illegal edit" hole: `[A]`
- Four separate NOT NULL player columns make "not 4 players" unrepresentable.
- One `loser` column makes "2 losers" unrepresentable.
- `CHECK (loser IN (p1,p2,p3,p4))` and a distinct-players CHECK reject a loser who was not at the table or a repeated player, on both insert and update.

Interfaces/APIs:
- Read: `GET` on the `games`, `players`, and `seasons` tables via Supabase REST, anon key, RLS read-only; GP/L are tallied client-side (no `v_standings` view). `[S: Supabase docs]` for RLS behavior.
- Write: `POST` to Edge Function `admin` with `{ action, passcode, payload }`, where action is `log_game | undo_last | edit_loser | delete_game | start_season`. `[A]`

Edge cases we handle (full list in the PRD section 8):
- Save blocked if no loser or more than 1 loser marked (UI plus DB CHECK). `[A]`
- Loss rate never divides by zero: players with 0 games show a dash and are unranked. `[A]`
- Under 5 games: shown in "not enough games yet", unranked in loss-rate mode. `[A]`
- Edit that would break the invariant is rejected by the CHECK constraints. `[A]`
- Concurrent devices: only the admin writes, viewers are read-only, so last admin write wins with no merge conflict. `[A]`

## 5b. Integration & responsibility

| Interface | From → To | Owner (build) | Owner (run) | Who fixes it when it breaks | Failure behavior |
|---|---|---|---|---|---|
| Read standings | Frontend → Supabase REST | Claude Code | Supabase (managed) | Levi (config) | Page shows last successful load or an error banner; no data loss |
| Admin write | Frontend → Edge Function → Postgres | Claude Code | Supabase (managed) | Levi (rotate passcode/keys) | Write rejected; UI keeps the last valid state; nothing partial committed |
| Static hosting | Browser → Netlify/Vercel | Claude Code | Netlify/Vercel (managed) | Levi (redeploy) | Old build still served; data in Supabase unaffected |

## 5c. Data contracts

Edge Function `admin` request: JSON `{ action: string, passcode: string, payload: object }`. Response: `{ ok: boolean, data?: object, error?: string }`. `[A]`
- `log_game` payload: `{ p1, p2, p3, p4, loser }` (player ids; loser must be one of the four). Server re-validates before insert. `[A]`
- `edit_loser` payload: `{ game_id, loser }`. Server checks loser is one of that game's four players. `[A]`
- `undo_last`, `delete_game` payload: `{}` or `{ game_id }`. `start_season` payload: `{ name }`. `[A]`
- Rejects: bad passcode → 401; invalid payload or invariant violation → 400 with a message; the client shows the message and changes nothing. `[A]`

## 5d. Failure modes & observability

- **Bad passcode / brute force:** the function returns 401. Add a simple per-IP rate limit or short lockout so the passcode cannot be brute-forced. `[OPEN — confirm rate-limit approach — Levi/builder — before launch]`
- **Supabase outage:** reads and writes fail; the page shows an error banner and the admin retries later. Managed uptime, no on-call. `[A]`
- **Bad data entry (wrong loser):** caught socially and fixed with undo or edit. No automated reconciliation in v1 (PRD section 9). `[A]`
- **Observability:** the Edge Function logs each write (action, result, timestamp) to Supabase function logs; that is the audit trail. `[S: Supabase docs]`

## 6. Other options considered

- **Picked — Supabase + static vanilla JS:** one managed store gives cross-device persistence and read-only public access via RLS with almost no backend code; vanilla JS keeps the app tiny, which the council pushed for. `[A]`
- **Skipped — single HTML file with localStorage:** simplest to build but fails the core requirement; data lives on one device and dies with it. `[A]`
- **Skipped — Firebase + React:** realtime is nearly free, but it ties us to Firestore's model and adds a build step and framework for a 4-friend scoreboard. `[A]`
- **Skipped — client-side-only passcode:** dead simple, but a technical friend could read the anon key and write directly, so it is not real protection. `[A]`

## 7. How it ships & how we undo it

- **Rollout:** build against a Supabase dev project, seed the 4 players and Season 1, test with the group for a week, then point the site at a prod project. No existing users to migrate. `[A]`
- **Testing:** unit tests for the ranking, tiebreak, threshold, and loss-rate math (pure JS, no DB); integration tests that a `log_game` writes correct rows and that an anon key write is rejected; a manual 2-device check that a game logged on one phone shows on another after refresh. `[A]`
- **Rollback:** redeploy the previous static build to undo a frontend change; data in Supabase is untouched. Schema changes ship as reversible migrations. In-app recovery: undo-last, season archive, and export give three layers before anything is truly lost. `[A]`

## 7b. Environments & cutover

Two Supabase projects: dev and prod. Frontend reads `SUPABASE_URL` and anon key from build config per environment. Cutover is a one-line config switch plus a fresh Season 1 in prod. No vendor coordination needed. `[A]`

## 8. Risks

| Risk | Plan |
|---|---|
| Passcode leaks or is brute-forced | Real server-side check, rate limit, rotatable passcode; export as backup if someone tampers. `[A]` |
| Admin forgets to log games (council's top human risk) | Keep logging to 3 taps; "loser of the night" surfaces a missed night; admin can backfill. No auto-reconciliation. `[A]` |
| Anon key misused | RLS denies all writes to anon; verified by a test that an anon insert fails. `[A]` |
| Two sorts are redundant for this group | Ship both, but the PRD open question asks the group how often the lineup changes; drop the toggle if attendance is always even. `[A]` |
| Free-tier limits | Dataset is tiny; well under Supabase and Netlify free limits. `[S: Supabase docs]` |

## 9. Plan & timeline

See the companion build plan (BUILD-PLAN-card-standings-tracker.md) for the epic-by-epic sequence and Claude Code prompts.

| Milestone | What's done by then | Owner | Target date |
|---|---|---|---|
| M1 Schema live | Tables, constraints, view, RLS, seed in Supabase dev | Claude Code | TBD |
| M2 Write path | `admin` Edge Function with passcode + all actions, tests pass | Claude Code | TBD |
| M3 Read UI | Standings table, both sorts, legend, luck line | Claude Code | TBD |
| M4 Admin UI | Log, undo, edit, delete, season, loser-of-the-night, export | Claude Code | TBD |
| M5 Ship | Security + verification gate passed, deployed, 2-device check | Claude Code + Levi | TBD |

## 10. Open questions

- [OPEN — Do you need both sorts, or just loss rate? Ask the 4 players how often the lineup changes — Levi — before M3]
- [OPEN — Rate-limit / lockout approach for the passcode on the Edge Function — Levi/builder — before M5]
- [OPEN — Netlify vs Vercel for hosting (either works) — Levi — before M5]
- [OPEN — Who is the human that verifies the design and signs this TRD, moving it to Approved — Levi — before M1]

---

## Appendix — Vibe-code-reviewer checkpoints (planning phase)

Run at design time, before any code. These gate the build.

```
CHECKPOINT 1: ARCHITECTURE
[PASS]  Complexity justified for scope? Yes. One managed DB, one small function, static frontend. No framework, no custom server.
[PASS]  External dependencies minimal and known-safe? Supabase + a static host. Both managed, free tier, widely used.
[PASS]  Error surface identified? Bad passcode, invalid payload, DB constraint violation, Supabase outage, stale read. Listed in 5d.
[PASS]  Rollback strategy defined? Redeploy previous static build; reversible migrations; undo/archive/export in-app. Data persists in Supabase.
[PASS]  Testable in isolation? Ranking/threshold/tiebreak math is pure JS, unit-testable with no DB. Write path testable against a dev project.
Blocker: none
```

```
CHECKPOINT 2: SPECIFICATION
[PASS]  Every action has a signature and error semantics? Yes. Edge Function actions defined in 5c with request/response and reject codes.
[PASS]  Data model has constraints and invariants stated? Yes. 4 player columns, 1 loser column, CHECK constraints in Design.
[PASS]  Examples hand-computed? Yes. Appendix A of the PRD gives worked standings; build plan repeats them as test vectors.
[PASS]  Spec specific enough to test without reading code? Yes. Ranking rules, tiebreaks, and threshold are fully specified in PRD section 2 and 7.5.
Blocker: none. One [OPEN] on rate-limiting does not block spec; it is a hardening detail carried to M5.
```

Two human decisions the reviewer flags as not-to-automate: a person must approve this spec before implementation, and a person must read and approve the final diff before it goes live.
