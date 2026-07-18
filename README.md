# LOTD — Loser of the Day

A shared scoreboard for a fixed group of friends playing a 4-player card game where
exactly one person loses each game. One admin logs results; everyone opens the same
URL to read the standings, ranked by **loss rate** (skill) or **games not lost**
(showing up). Named for its signature callout: the day's biggest loser.

## Status
Core UX built and verified live: standings (both sorts + the 25% luck line),
passcode unlock, 3-tap log, undo. Backend (Supabase schema + admin Edge Function)
is next; it wires in at deploy.

- **Spec:** [PRD](PRD-card-game-standings-tracker.md) · [TRD](TRD-2026-001-card-standings-tracker.md) · [build plan](BUILD-PLAN-card-standings-tracker.md)
- **Design system:** [design-system/MASTER.md](design-system/MASTER.md)

## Run locally
```sh
python3 -m http.server 8138   # then open http://localhost:8138/?mock=1
```
`?mock=1` runs the whole app on in-memory demo data (a seeded board + players) with **no
Supabase and no passcode** — log games and see the **PECUNDANG** reveal instantly. Data
resets on reload. Without `?mock=1` the app talks to the configured backend.

**Logging by confession:** tap **Log game**, type `<name> pecundang` (e.g. `Levi
pecundang`) to name the loser — they're auto-added as the 4th player — then pick the 3
others who played. The confess-word doubles as the shared secret, so no separate unlock is
needed; on the live backend set `ADMIN_PASSCODE=pecundang`.

## Test
```sh
node --test js/ranking.test.mjs js/tally.test.mjs js/api.test.mjs   # 32 tests
```
Pure derived-stat logic (`tally` + `ranking`) is fully unit-tested with no DB.

## Stack
Static vanilla JS (no build step) + Supabase (Postgres + one passcode-gated Edge
Function) at wiring. GP/L are tallied in the browser from the games log, so there is
no `v_standings` view to maintain — one tested source of truth.
