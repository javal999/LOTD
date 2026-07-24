# Development plan — Padel Americano board

**Status:** ✅ Phase A + Phase B built & shipped · **Date:** 2026-07-24 (updated 2026-07-25)

> **Build notes (2026-07-25):** Phase A shipped in commit `b5ab05d`. Phase B built here: courts are
> chosen per session (default 1) and the whole schedule is generated up front (both confirmed with
> Levi). Open questions resolved — A1: all-time by **average** points/round; A2 & the session summary:
> **fewest points**. B1: the schedule is a suggestion, you log the rounds you actually play. B2: both a
> live session leaderboard and the persistent all-time board. The generator lives in `americano.mjs`
> (min-cost matching per round: everyone partners everyone once where the roster allows, sit-outs and
> opponents balanced); sessions are `padel_sessions` + `sports_games.session_id` (migration 0010).

A "Padel — Americano" board type: you play in rotating pairs, score as an individual, and the board
ranks people by their own points — pointed at the *loser* (fewest points), LOTD-style. Grounded in
common Americano practice ([sources in the earlier research](PRD-v4-multi-format-games.md)).

**Decisions locked with Levi:**
- **Points-per-round is adjustable and chosen at board creation** (16 / 21 / 24 / 32 — a number field).
- Individual leaderboard; **biggest loser = fewest total points**, **tie-break = point difference**.
- Pairing generation ("who partners whom") is in scope.

---

## Phase A — adjustable points + individual-points leaderboard *(smaller, ships value alone)*

**Board creation.** When you pick **Padel**, a "points per round" number field appears (default 21).
Stored on the board.

**Scoring becomes board-configurable, snapshotted per game.**
- `leaderboards.points_target int` — the board's round length.
- `sports_games.points_target int` — copied onto each padel game at write time, so changing the board
  later never invalidates old rounds (same immutability trick as the rest of v4).
- The padel `valid_score` CHECK changes from hard-coded `sum = 21` to `sum = points_target`.

**A points leaderboard (new for padel).** A view `v_padel_standings(leaderboard_id, player_id, name,
rounds, points_for, points_against)`. The board ranks:
1. **`points_for` ascending** — fewest points = biggest loser (the pecundang).
2. **tie-break: point difference** `(points_for − points_against)` ascending — most-negative loses.
3. then rounds played, then name.

The padel board shows this instead of loss-rate; the spotlight crowns the fewest-points player.

**Effort:** moderate — one column on each of two tables, one CHECK change, one view, a number field
in the create sheet, and a points-based render path for padel. No sessions yet; you still log each
round by hand (pick 4 → split → score), which already works today.

**Open question A1:** all-time leaderboard by **total points** (rewards attendance) or **average
points per round** (fairer with sit-outs)? Americano-the-event uses total (everyone plays equal
rounds); LOTD-the-history spans many nights. *My lean: average per round for all-time, so a regular
isn't punished for showing up more.*

**Open question A2:** the daily "Loser of the Day" on a padel board — **fewest points today** (Americano-
native) or **most rounds lost today** (LOTD-native raw count)? *My lean: fewest points today.*

---

## Phase B — the Americano session + pairing generator *(bigger; the "generate the couples" part)*

**Start a session.** Tap **Start Americano** → pick who's here tonight → the app **generates the full
pairing schedule**.

**The algorithm (standard round-robin "circle method").** Fix one player, rotate the rest; every
player partners every other **exactly once**. Round count is fixed:
`matches = players × (players − 1) / 4` → **8 players = 14 matches over 7 rounds**; 12 = 33 / 11.
Odd/excess players get **sit-outs distributed evenly**, announced before round 1.

**Log round by round.** Each round shows its generated pairings (`Levi·Rafi vs Nadhif·Sebas`); you
type the score, it validates against `points_target`, credits each player individually, and advances.
A **live leaderboard** updates as rounds land.

**Data model:** `padel_sessions(id, leaderboard_id, game_date, roster int[], created_at)`;
`sports_games.session_id` (nullable) links a round to its session. The all-time board still
accumulates across sessions.

**Effort:** large — the session model, the generator, a round-runner UI, live standings, and
sit-out handling. Several evenings.

**Open question B1:** what if a night doesn't finish the full schedule (7 rounds is ~90 min)?
*My lean: the schedule is a suggestion — you log the rounds you actually play; unplayed rounds just
don't exist. Never block on "finish the schedule" (this was the abandonment risk in my earlier
benchmark).*

**Open question B2:** persistent all-time leaderboard across sessions, per-session summary, or both?
*My lean: both — a session summary card (the night's pecundang) + the all-time board.*

---

## Recommendation

**Build Phase A first, ship it, then decide on Phase B.** Phase A delivers exactly what you asked for
(adjustable points at creation + individual points leaderboard + point-difference tie-break) and is a
fraction of the work. Phase B (the pairing generator) is the big, genuinely useful but heavy part —
worth doing, but better as its own focused effort once A is live and you've felt it in a real game.

**The one thing to confirm before I start Phase A:** open questions **A1** (total vs average points)
and **A2** (daily loser = points or rounds-lost). My leans are average + fewest-points-today.
