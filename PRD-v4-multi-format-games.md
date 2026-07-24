# PRD v4 — Multi-format games: any player count, teams or individuals

**Status:** Draft for review · **Author:** Levi (with Claude) · **Date:** 2026-07-21
**Supersedes:** nothing — extends [PRD v3](PRD-card-game-standings-tracker.md)

---

## TL;DR

LOTD today can record exactly one shape of game: **4 players, exactly 1 loser**. That shape is
welded into the database (`p1..p4` + `loser` columns + CHECK constraints), which is why it has been
so reliable — and why it cannot record a padel night.

v4 replaces that single shape with a general one: a game is **a set of sides, each holding one or
more players, each side getting a result**. Everything today becomes one preset of that model
("4 sides of 1 player, one side loses"), and padel, 1v1, and team games become other presets.

The hard part is not the schema — it is **keeping the numbers comparable**. A 40% loss rate is
excellent in a 4-player card game and dismal in 1v1. v4 solves this with a **luck-adjusted Loss
Index**: we compare your actual losses to how many you'd have lost by pure chance given the games
you actually played. `1.0` = exactly average luck. That generalises today's "25% is chance" legend
to every format, and makes mixed formats honestly comparable for the first time.

**LOTD stays LOTD.** Every format must still answer one question: *who is the biggest loser?*

---

## 1. Problem statement

The group plays more than one game. The scoreboard only understands one.

- **Player count is fixed at 4.** A 3-player or 6-player card night cannot be logged at all. The
  logging sheet literally requires exactly 4 taps.
- **There is no concept of a team.** Every player is an island. Padel, futsal, doubles tennis, and
  any 2v2 card game are unrecordable.
- **"Losing" is the only outcome.** Games with scores (padel Americano), rankings (Mario Kart), or
  draws have nowhere to go.

The cost of not solving it: the group keeps a second scoreboard somewhere else (a WhatsApp message,
a Notes file, an Americano app), the rivalry data fragments, and LOTD stops being *the* place where
the running joke lives. The joke is the product.

**Evidence from real use:** the live `Seven P3` board has 7 players but every game must be squeezed
into groups of exactly 4, so whoever sits out is invisible to the record.

---

## 2. Research: how social sports actually score

I looked at how the padel world already solved "team play, individual glory", because it is the
exact problem here and it is well-trodden.

### Americano
Rotating partners on a **fixed schedule** — everyone partners with everyone else once. You play in
pairs, **but the points are yours alone**. A 24-point round finishing 15–9 gives *each* winner 15
points and *each* loser 9. Most total points wins the night.

### Mexicano
Same individual scoring, but pairings are **dynamic**: after each round the app re-pairs by current
standing (1st + 4th vs 2nd + 3rd). Produces tighter matches because you play with and against people
at your level.

### King of the Court (King of the Hill)
**Winners stay on, losers go to the back of the queue**, next pair challenges. Short races to 4/5/7
points. Each player on a winning pair banks a point per game won. With an odd headcount, **someone
sits in the queue** — they simply do not have a game that round. Designed for 12+ players.

### What this tells us

1. **"Team" and "individual" are not opposites — they are two layers.** You *play* as a pair and you
   *score* as an individual. Our model must record the side you were on and then credit the humans.
2. **Sitting out must be first-class.** With odd numbers somebody always sits; they must not be
   charged a game.
3. **Points and win/loss are genuinely different metric families**, and mixing them on one
   leaderboard is meaningless. Padel is inherently 2v2 — there is no singles padel — so a padel board
   is always "2 sides".

**On "cappuccino":** I could not find this format in any padel source, English or Indonesian — see
[Open Questions](#16-open-questions). The three formats above cover the *pattern* it likely belongs
to, so the model is built to absorb it once defined.

**Sources:** [Padeli — formats explained](https://padeli.com/get-started/formats/) ·
[Padel Fast — Americano](https://www.padelfast.com/formats/americano) ·
[Padel Fast — Mexicano](https://www.padelfast.com/formats/mexicano) ·
[Simple Padel — Americano scoring](https://simplepadel.com/how-to-play-an-americano-in-padel/) ·
[Paddle Pals — King of the Court](https://paddlepals.co.uk/games/king-of-the-court-padel) ·
[Live For Padel — KOTC rules](https://www.liveforpadel.com/blog/padel-king-of-the-court) ·
[Club Padel Tennis (ID) — format panduan](https://clubpadeltennis.com/panduan-turnamen-untuk-pemula-aturan-format-dan-tips/)

---

## 3. Goals

1. **Any player count.** Log a game with 2–24 participants without the app fighting you.
2. **Teams as a first-class concept**, with results credited to every human on the side.
3. **Padel-night support end to end** — an Americano session logged in under 60 seconds per round.
4. **Numbers stay honest across formats.** A player's standing must mean the same thing whether they
   play 1v1 or 6-way free-for-all. Target: the Loss Index for existing card games is **numerically
   identical** to today's loss rate ÷ 0.25.
5. **Zero regression for the card game.** Today's 3-tap flow must not get slower or harder.

## 4. Non-goals

1. **Not a tournament organiser.** We record what happened; we do not generate Americano draws,
   schedule rounds, or re-pair by rank. Those apps exist and do it well. *(Rationale: enormous scope,
   and the group already decides pairings socially.)*
2. **No skill ratings (Elo/Glicko).** Tempting, but it changes the product from "who lost" to "who is
   good", which is a different app. *(Revisit only if asked.)*
3. **No live/in-progress scoring.** You log a game after it finishes, as today.
4. **No cross-leaderboard aggregation.** Each board stays its own world.
5. **No per-player accounts or auth.** The open-write model stays as decided.

---

## 5. The core model change

Today:

```
game = (p1, p2, p3, p4, loser)          -- 4 humans, 1 loser, enforced by CHECK
```

v4:

```
game    = { side₁, side₂, … sideₙ }      -- n ≥ 2
side    = { players[1..m], result }      -- m ≥ 1
result  = outcome (win|loss|draw) | points (number) | rank (1..n)
```

Everything we have today is the preset **"n sides of exactly 1 player, exactly one side is a loss."**

### Why this shape

- A **side** is the unit that wins or loses. A **player** is the unit that gets credited. Separating
  them is what makes "play as a pair, score as an individual" fall out for free.
- It degrades gracefully: a 1-player side *is* an individual, so free-for-all and team games use one
  code path.

### The integrity tradeoff — read this before approving

Today's "exactly 4 players, exactly 1 loser" guarantee is **structural** — the database physically
cannot hold a malformed game. That is the single best property of the current design and it is why
the standings have never been wrong.

A flexible model **cannot** express "exactly one loss" as a column CHECK, because the sides live in
another table. We are trading a structural guarantee for an enforced one.

**Mitigation (all three required, non-negotiable):**
1. `UNIQUE(game_id, player_id)` — a human still cannot appear twice in one game, structurally.
2. A **deferred DB trigger** validating side/result rules per format at COMMIT — not just app code.
3. Property tests that generate malformed games and assert the DB rejects every one.

If we ship only app-level validation, we will eventually corrupt the standings. Call it now.

---

## 6. Format catalogue

| Preset | Sides | Players/side | Result | "Biggest loser" is |
|---|---|---|---|---|
| **Odd one out** *(today)* | 3–8 | 1 | exactly one side = loss | the one who lost |
| **Head to head** | 2 | 1 | win / loss / draw | the loser |
| **Teams** | 2–4 | 1–6 | win / loss / draw | everyone on the losing side |
| **Padel points** *(Americano / Mexicano)* | 2 | 1–2 | points per side | lowest point share |
| **King of the Court** | 2 | 2 | win / loss | fewest games won |
| **Free-for-all rank** *(P2)* | 3–8 | 1 | rank 1..n | last place |

Formats belong to one of two **scoring families**, and a leaderboard picks one:

- **Loss-based** — odd-one-out, head-to-head, teams, KOTC. Ranked by **Loss Index**.
- **Points-based** — Americano, Mexicano. Ranked by **Point Share**.

Formats *within* a family may be mixed on one board (the maths normalises them). Families may
**not** be mixed — see [Edge cases](#12-edge-cases--negative-cases) EC-31.

---

## 7. Scoring: keeping numbers honest across formats

### The problem
Loss rate is only meaningful against its baseline. With 4 sides, chance = 25%. With 2 sides, chance =
50%. Today's legend hardcodes 25%, which becomes a lie the moment a 1v1 is logged.

### The fix: Loss Index

For each **decisive** game a player played, their expected share of the blame is `1 / (number of
sides)`.

```
expected_losses = Σ  1 / sides(game)        over decisive games played
loss_index      = actual_losses / expected_losses
```

| Loss Index | Meaning |
|---|---|
| `1.00` | exactly what chance predicts — perfectly average |
| `> 1.00` | losing **more** than chance. The pecundang zone. |
| `< 1.00` | beating luck |

**Why this is the right generalisation:** for a board of only 4-player card games, every game
contributes exactly 0.25, so `loss_index = loss_rate / 0.25`. Today's "beats luck" check (`< 25%`)
becomes exactly `loss_index < 1.0`. **The existing standings do not change meaning** — they get a
new scale. That is the migration-safety property we want.

It also handles the awkward real case: someone who only ever plays 1v1 is *expected* to lose half
their games, and is no longer unfairly branded a loser next to a 6-player-game specialist.

### Points family: Point Share

Total points reward long rounds. A 24-point round and a 16-point round are not comparable. So:

```
point_share = points_for / (points_for + points_against)
```

Length-independent, and its chance baseline is `1 / sides` = **0.50** for padel — the same baseline
concept as the loss family. Biggest loser = lowest point share. Total points is kept as a secondary
display because players care about it.

### Provisional threshold
`MIN_GAMES_FOR_RATE` (today 5) becomes **per-leaderboard configurable**, default 5. Rationale: a
2-side format needs fewer games for signal than an 8-side one, and groups play at different tempos.

---

## 8. User stories

**Card group (today's users — must not regress)**
- As a card player, I want to log a 4-player game in the same 3 taps as before, so the upgrade costs
  me nothing.
- As a card player, I want to log a 5- or 6-player night, so nobody sitting in is invisible.

**Padel group (new)**
- As a padel organiser, I want to record a 2v2 round with its score, so the night's points are kept.
- As a padel player, I want my points credited to *me* regardless of partner, so the leaderboard
  reflects my night, not my luck with partners.
- As a padel organiser, I want to log a whole Americano session round-by-round without re-picking
  the roster each time, so logging does not interrupt play.
- As someone who sat out a round, I want that round to not count against me.

**Everyone**
- As a player, I want to know whether I am genuinely unlucky or genuinely bad, so the roasting is
  evidence-based.
- As a scorekeeper, I want to fix a wrong score without deleting the round.
- As a new player, I want to see that my rank is provisional until I have played enough.

---

## 9. Step-by-step: how to use it

### Flow A — Create a board and choose its format

1. Tap **Unlock**, enter the passcode.
2. Tap **New leaderboard**.
3. Enter a name — e.g. `Padel Jumat`.
4. Choose a **sport/label** (free text, cosmetic): `Padel`.
5. Choose a **scoring family**:
   - **Who lost** → for card games, futsal, any win/lose sport.
   - **Points** → for padel Americano/Mexicano.
6. Choose the **default format** for that family (e.g. *Padel points*). This only pre-fills the log
   sheet; you can pick another format in the same family per game.
7. Set **minimum games to rank** (default 5).
8. Tap **Create**.

> ⚠️ The scoring family **locks** the moment the first game is logged. Changing it later would make
> old and new games incomparable. To change it, export, delete the board, and start fresh.

---

### Flow B — Log an "odd one out" game (the card game, now any size)

1. Tap **Log game**.
2. **Who played?** — chips for every active player. Tap each participant. The counter reads `4/4`,
   `5/5`… any count from 3 to 8. *(If the board has exactly 4 active players they are pre-selected,
   preserving today's 3-tap flow.)*
3. **Who lost?** — type `<name> pecundang` (the confession flow, unchanged) **or** tap the loser's
   tile.
4. *(Optional)* tap **ubah tanggal** to backdate.
5. Tap **Simpan**.
6. The **PECUNDANG** stamp fires with the roast, and an **undo** is available for 4 seconds.

**What gets recorded:** N sides of 1 player each; the loser's side gets `outcome = loss`, everyone
else `win`. Expected-loss contribution for that game = `1/N`.

---

### Flow C — Log a team game (2v2, win/loss)

1. Tap **Log game**.
2. **Who played?** — tap all 4 (or 6, 8…) participants.
3. Tap **Split into teams**. Players are dealt into **Side A** and **Side B**; drag or tap a name to
   move it across. The header shows `A: 2 · B: 2`.
4. Tap the side that **lost** (the whole card goes clay-red — one tap, not per-player).
   - Or tap **Seri / Draw** if the board allows draws.
5. Tap **Simpan**.

**What gets recorded:** 2 sides; every player on the losing side gets a loss; expected contribution
= `1/2 = 0.5` each. Team size does **not** distort the index — a 3-player side still shares one side
result, and each member is charged the same 0.5 expectation.

---

### Flow D — Run a padel Americano session

The session exists so you pick the roster **once** and then log rounds fast.

1. Tap **Log game → Start a session**.
2. **Who is here tonight?** — tap all attendees (say 8). Tap **Start**.
3. **Round 1** opens with the night's roster only:
   a. Tap the 4 players on court. The other 4 are automatically **sitting out** and get no game.
   b. Tap **Split into teams** (or accept the suggested split).
   c. Enter the score: two number fields, `A [15] – [9] B`. The target (24) is remembered from the
      previous round.
   d. Tap **Simpan round**.
4. The round is saved and **Round 2** opens with the same roster, teams cleared, ready for the next
   pairing. Repeat.
5. Tap **End session** when the night is done.
6. The session summary shows each player's **points, point share, and rounds played** — and crowns
   the night's **pecundang** (lowest point share).

**What gets recorded:** one game per round, each with 2 sides, `points_for`/`points_against` per
side. Every player on a side is credited that side's points individually — exactly the Americano
rule. Sitting out logs nothing, so `games_played` stays honest.

---

### Flow E — Fix a mistake

1. Unlock → **Recent games**.
2. Find the row (newest first; team games show `A: Levi·Rafi — B: Nadhif·Sebas`).
3. **Edit** to change the losing side, a score, or the roster; **Delete** to remove the round
   (confirm required).
4. Standings recompute immediately.

Right after saving, the reveal's **undo** removes that round with no unlock needed.

---

## 10. Requirements

### P0 — cannot ship without

| # | Requirement | Acceptance criteria |
|---|---|---|
| R1 | Game supports 2–24 participants across 2–8 sides | Given a 6-player odd-one-out game, when saved, then all 6 appear in standings with gp+1 |
| R2 | Sides with 1..6 players; result credited to every member | Given a 2v2 where side B loses, when saved, then both B players get losses+1 and both A players get 0 |
| R3 | A player cannot appear twice in one game | Enforced by `UNIQUE(game_id, player_id)`; the API returns a clear error, not a 500 |
| R4 | Loss Index replaces raw loss rate as the loss-family ranking metric | For a board of only 4-player games, `loss_index == loss_rate / 0.25` for every player (property test) |
| R5 | Points family with `points_for`/`points_against`, ranked by point share | Given a 15–9 round, when saved, then each winner gets +15/+9 and each loser +9/+15 |
| R6 | Scoring family locks after the first game | Attempting to change it returns `409` with an explanatory message |
| R7 | Lossless migration of all v3 games | Post-migration, every player's gp/losses is byte-identical to pre-migration (verified by a migration test, not by eye) |
| R8 | Format rules enforced at the DB layer, not only in the Edge Function | Deferred trigger rejects: 0 or 1 sides, empty sides, ≠1 loss in odd-one-out, negative points |
| R9 | Today's 4-player flow is unchanged in tap count | 4 active players → pre-selected → confess → save = 3 interactions |
| R10 | Sitting out records nothing | A session round with 8 present and 4 on court increments gp for exactly 4 |

### P1 — fast follow

| # | Requirement |
|---|---|
| R11 | Sessions (Flow D) with roster memory and a session summary card |
| R12 | Draw support for head-to-head and teams |
| R13 | Per-leaderboard `min_games_to_rank` |
| R14 | Team-aware Recent games display (`A: … — B: …`) |
| R15 | Export includes sides, participants, and scores; standings rebuildable from it alone |

### P2 — design for, don't build

| # | Requirement |
|---|---|
| R16 | Free-for-all ranking (1..n) — Mario Kart / board games |
| R17 | Mexicano auto-pairing suggestions by current standing |
| R18 | Per-format "biggest loser" spotlights on one board |
| R19 | Handicap / partner-adjusted stats ("who drags their partner down") |

---

## 11. Data model

```sql
-- leaderboards gains format identity
alter table leaderboards
  add column scoring_family text not null default 'loss'   -- 'loss' | 'points'
    check (scoring_family in ('loss','points')),
  add column default_format text not null default 'odd_one_out',
  add column min_games_to_rank int not null default 5 check (min_games_to_rank between 1 and 50),
  add column sport text;                                   -- cosmetic label

-- games loses p1..p4/loser, gains format + optional session
create table games (
  id             bigint generated always as identity primary key,
  leaderboard_id bigint not null references leaderboards(id) on delete cascade,
  session_id     bigint references sessions(id) on delete set null,
  game_date      date not null default current_date,
  format         text not null,
  created_at     timestamptz not null default now(),
  check (game_date <= current_date + 1)
);

create table game_sides (
  id       bigint generated always as identity primary key,
  game_id  bigint not null references games(id) on delete cascade,
  side_no  smallint not null check (side_no between 1 and 8),
  outcome  text check (outcome in ('win','loss','draw')),
  points_for     int check (points_for >= 0),
  points_against int check (points_against >= 0),
  rank     smallint check (rank >= 1),
  unique (game_id, side_no)
);

create table game_participants (
  game_id   bigint not null references games(id) on delete cascade,
  side_id   bigint not null references game_sides(id) on delete cascade,
  player_id bigint not null references players(id) on delete restrict,
  primary key (game_id, player_id)          -- ← structural: one human, one slot, per game
);
```

**Migration from v3 (lossless, reversible):**
```
for each v3 game:
  create game(format='odd_one_out', same date/leaderboard/created_at)
  for i in 1..4:
    side = create_side(side_no=i, outcome = (p_i == loser ? 'loss' : 'win'))
    create_participant(side, p_i)
```
Then assert `SELECT name, gp, losses FROM v_standings` matches a snapshot taken before migration.
**Ship the assertion as a test, not a manual check.**

`v_standings` is rewritten to aggregate over participants and to emit `decisive_games`,
`expected_losses`, `points_for`, `points_against` so all metrics derive in one view.

---

## 12. Edge cases & negative cases

### Roster & participants
| # | Case | Expected behaviour |
|---|---|---|
| EC-1 | Same player on both sides | Rejected — PK violation surfaced as `"a player can only be in a game once"` |
| EC-2 | Same player twice on one side | Same as EC-1 |
| EC-3 | Fewer than 2 participants | Rejected: `"a game needs at least 2 players"` |
| EC-4 | Only 1 side (everyone same team) | Rejected: `"a game needs at least 2 sides"` |
| EC-5 | A side with 0 players (after an edit) | Rejected; edit is atomic — no partial save |
| EC-6 | Player not in this leaderboard | Rejected (existing rule retained) |
| EC-7 | Archived player added to a new game | Rejected (existing rule retained) |
| EC-8 | Archived player in a *historic* game | Kept and counted — their games happened |
| EC-9 | >24 participants or >8 sides | Rejected with a stated cap, not a crash |
| EC-10 | Uneven teams (3v2) | **Allowed**, with a UI note. Each side is still one result; expectation is 1/sides regardless of size |
| EC-11 | Player deleted who has games | Archived, never hard-deleted (FK `RESTRICT` retained) |
| EC-12 | Player renamed mid-history | Fine — everything is id-based |

### Results & scoring
| # | Case | Expected behaviour |
|---|---|---|
| EC-13 | Odd-one-out with 0 losers | Rejected: `"pick who lost"` |
| EC-14 | Odd-one-out with 2+ losers | Rejected by trigger: exactly one `loss` per game |
| EC-15 | Draw in a format that disallows it | Rejected |
| EC-16 | Draw where allowed | All sides `draw`; **gp increments, losses do not, and the game is excluded from `expected_losses`** so the index stays neutral (see EC-17) |
| EC-17 | A board with many draws | Loss Index uses **decisive games only** in both numerator and denominator — draws never inflate or deflate it |
| EC-18 | Negative points | Rejected (`points >= 0`) |
| EC-19 | 0–0 score | Treated as a draw if draws allowed; else rejected |
| EC-20 | Tie on points in Americano | Both sides `draw`, point share 0.5 each |
| EC-21 | Points entered but no winner marked | Outcome **derived** from points (higher = win, equal = draw) — never ask twice |
| EC-22 | Rounds of different lengths in one session (24 vs 16) | Allowed — **point share is length-independent**; total points shown but not the ranking metric |
| EC-23 | Absurd score (999–0) | Allowed but flagged in UI (`unusually large`); we do not police friends' typos, we make them visible |
| EC-24 | Score entered for a loss-family board | Rejected — wrong family for this board |

### Stats & ranking
| # | Case | Expected behaviour |
|---|---|---|
| EC-25 | Player with 0 games | Unranked, `loss_index = null`, shown in the "not enough games" group |
| EC-26 | Player below `min_games_to_rank` | Provisional — listed but unranked (existing behaviour) |
| EC-27 | Player with games but all draws | `decisive_games = 0` → index undefined → **provisional**, never `0/0` or `NaN` |
| EC-28 | Everyone tied on index | Deterministic tiebreak: index desc → more decisive games → fewer games-not-lost → name A→Z |
| EC-29 | Only 1 player has ≥ threshold | They rank #1 alone; the rest sit in the provisional group |
| EC-30 | Board with a single 1v1 format | Baseline is 0.5; legend text must read "50% is chance here", not a hardcoded 25% |
| EC-31 | Mixing loss-family and points-family on one board | **Prevented** by the family lock (R6). This is the one mix that has no honest maths |
| EC-32 | Mixing formats *within* a family | Allowed — Loss Index normalises them. This is the whole point of the index |

### Sessions (Americano)
| # | Case | Expected behaviour |
|---|---|---|
| EC-33 | Odd headcount → someone sits out | They are simply not a participant; **no gp, no loss, no points** |
| EC-34 | Player leaves mid-session | Deselect them from later rounds; earlier rounds stand |
| EC-35 | Player arrives mid-session | Add to roster; they only carry rounds they played |
| EC-36 | Session abandoned without "End" | Rounds already saved are permanent; the session card just stays open. **Never lose saved rounds** |
| EC-37 | Two sessions on the same date | Both fine; "today's biggest loser" aggregates across the date, matching v3 semantics |
| EC-38 | Session with 1 round | Valid |
| EC-39 | Deleting a session | Deletes the session grouping only; **rounds are kept** unless explicitly deleted (destructive-by-surprise is the worst failure mode) |

### Time, integrity, abuse
| # | Case | Expected behaviour |
|---|---|---|
| EC-40 | Game dated in the future | Rejected (existing rule, client supplies local `today`) |
| EC-41 | Backdated game | Allowed; lands on its own date for the daily spotlight |
| EC-42 | Timezone rollover at midnight | Client's local date wins (existing v3 behaviour retained) |
| EC-43 | Changing scoring family after games exist | `409` — export, delete, recreate |
| EC-44 | Migration run twice | Idempotent; second run is a no-op |
| EC-45 | Migration loses/duplicates a game | Caught by the pre/post standings assertion in CI, not in production |
| EC-46 | Concurrent logging by two people | Last write wins per game; games are independent rows so no lost updates |
| EC-47 | Griefing via open writes | Unchanged risk from v3, but **larger surface**: bigger payloads, more actions. Rate limit stays; consider capping games/day per IP |
| EC-48 | Malformed payload from a hand-crafted request | Rejected by the trigger even if Edge Function validation is bypassed (this is why R8 exists) |
| EC-49 | Very long team/player names | Escaped on render (existing `esc()`), length-capped on write |
| EC-50 | Export/import round-trip | Standings must rebuild from exported games alone — the existing `export.test.mjs` contract extends to sides and points |

---

## 13. Success metrics

**Leading (first 4 weeks)**
- ≥ 1 non-card leaderboard created and used for ≥ 3 sessions.
- Median time to log one Americano round **< 20 seconds** (measured by timestamp deltas between
  consecutive rounds in a session).
- Zero standings-correctness bugs reported.

**Lagging (first quarter)**
- The group stops keeping a parallel scoreboard elsewhere (ask them directly — n is small enough).
- Games logged per week ≥ today's rate (proves no regression in logging friction).
- ≥ 2 distinct formats in regular use.

**Guardrail**
- Card-game logging taps stay at 3. If it rises, we broke the thing that works.

---

## 14. Phasing

| Phase | Scope | Why this order |
|---|---|---|
| **v4.0** | New schema + migration + odd-one-out with 2–8 players + Loss Index | Highest value, lowest risk; proves the model with zero new UI concepts |
| **v4.1** | Teams (sides with >1 player), win/loss/draw, team-aware history | Unlocks futsal/doubles without touching scoring maths |
| **v4.2** | Points family, sessions, Americano/Mexicano flow | Biggest UI surface; deserves its own cycle |
| **v4.3** | P2 items (FFA rank, pairing suggestions) | Only if the group actually asks |

**Do not** ship 4.0 and 4.2 together. The migration is the riskiest thing in this document and it
should land alone, verifiable, with the old numbers provably intact.

---

## 15. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Migration corrupts historic standings | **High** | Pre/post assertion test; migration lands alone in 4.0; export a backup first |
| Loss of structural "one loser" guarantee | **High** | Deferred trigger + property tests (R8) — app-level validation alone is insufficient |
| Logging gets slower for the card group | Medium | R9 guardrail; pre-select when exactly the format's default count is active |
| Loss Index is confusing to players | Medium | Show it as a plain sentence too: "Nadhif loses 2.1× more than chance." Keep raw L and GP visible |
| Feature bloat kills a deliberately tiny app | Medium | Non-goals §4; P2 list is design-only |
| Open-write griefing on a bigger surface | Low-Med | EC-47; revisit the split-secret idea if it ever bites |

---

## 16. Open questions

| # | Question | Owner | Blocking? |
|---|---|---|---|
| Q1 | **What exactly is "cappuccino"?** Not found in any padel source, EN or ID. Is it a club-specific name for Americano/Mexicano, a mixed-gender variant, or something else? The model likely already covers it — I need the rules to confirm. | Levi | **Yes** for the padel phase |
| Q2 | Should a padel board rank by **point share** (length-independent, recommended) or **total points** (what players instinctively expect from Americano apps)? Or show both, rank by share? | Levi | Yes for 4.2 |
| Q3 | Do we want **draws** at all? The card game has none; futsal does. | Levi | No — default off, enable per board |
| Q4 | Is a **session** worth building, or is logging rounds one-by-one acceptable for a first pass? | Levi | No — 4.2 decision |
| Q5 | Should the Loss Index be the headline number, or stay behind the familiar loss-rate %? | Levi + the group | No |
| Q6 | Cap on games/day per IP given open writes? | Levi | No |

---

## Appendix A — Worked examples for tests

**A1. Mixed-format board, loss family**

| Player | Games | Actual losses | Expected | Index |
|---|---|---|---|---|
| Nadhif | 4× 4-player, 2× 1v1 | 3 | 4(0.25) + 2(0.5) = 2.0 | **1.50** |
| Levi | 4× 4-player, 2× 1v1 | 1 | 2.0 | **0.50** |

Nadhif loses 1.5× more than chance; Levi half as much. Both played identical schedules — which is
exactly what makes the comparison fair.

**A2. Pure 4-player board (migration safety)**
Player with 20 games, 8 losses → loss_rate 0.40; expected = 20 × 0.25 = 5; index = 8/5 = **1.60**.
Check: `0.40 / 0.25 = 1.60` ✓ — the index is a rescaling, not a new judgement.

**A3. Americano round**
8 players, 4 on court. Side A (Levi, Rafi) beats Side B (Nadhif, Sebas) 15–9 in a 24-point round.
- Levi: `points_for +15`, `points_against +9`, share 0.625
- Rafi: identical to Levi
- Nadhif, Sebas: `points_for +9`, `points_against +15`, share 0.375
- The 4 who sat out: **nothing recorded**
