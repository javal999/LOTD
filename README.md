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
python3 -m http.server 8138   # then open http://localhost:8138
```
Mock data resets on reload. The mock unlock accepts any passcode **locally** — the
real passcode gate is server-side (admin Edge Function), never in the browser.

## Test
```sh
node --test js/ranking.test.mjs js/tally.test.mjs js/api.test.mjs   # 32 tests
```
Pure derived-stat logic (`tally` + `ranking`) is fully unit-tested with no DB.

## Stack
Static vanilla JS (no build step) + Supabase (Postgres + one passcode-gated Edge
Function) at wiring. GP/L are tallied in the browser from the games log, so there is
no `v_standings` view to maintain — one tested source of truth.
