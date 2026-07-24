# PRD v4 — Multi-format games: one standing for table tennis *and* padel

**Status:** Draft for review · **Author:** Levi (with Claude) · **Date:** 2026-07-21
**Extends:** [PRD v3](PRD-card-game-standings-tracker.md)
**Driving use case:** one leaderboard the group can use for **both table tennis and padel**, scored
Americano-style, plus the existing card game.

---

## TL;DR

LOTD records exactly one shape of game — **4 players, exactly 1 loser** — welded into the database as
`p1..p4 + loser`. That rigidity is why the standings have never been wrong, and why it can't record
a table tennis or padel night.

v4 introduces **game types**. A leaderboard enables one or more of them; each logged game picks one
and *snapshots its rules*. That's what lets a single board hold a 1v1 table tennis game to 11 **and**
a padel Americano round to 24 — and rank everyone on one honest number.

**Decisions locked with Levi:**

| Decision | Choice |
|---|---|
| Sports on one board | **Table tennis + padel together** |
| Table tennis format | **Both singles (1v1) and doubles (2v2)** |
| Unit of record | **One game** — TT: to 11, win by 2 · Padel: a 24-point round |
| Ranking metric | **Point share** — `points_for / (points_for + points_against)` |
| Pairings | **Just record** — LOTD never decides who plays whom |

**Why one board works:** point share is *length-independent*. A table tennis 11–7 (share `0.611`) and
a padel 15–9 (share `0.625`) are directly comparable, because both ask the same question — what
fraction of the points on the table did you win? Total points could never do this; that's the single
most important consequence of Levi's metric choice.

**LOTD stays LOTD.** Every format still answers: *who is the biggest loser?*

---

## 1. Problem statement

The group plays three things — cards, table tennis, padel — and the scoreboard understands one.

- **Player count is fixed at 4.** A table tennis 1v1 can't be logged at all.
- **No concept of a side.** Every player is an island, so doubles and padel are unrecordable.
- **"Who lost" is the only outcome.** Scores have nowhere to go: an 11–0 thrashing and an 11–9
  nailbiter would look identical even if we could log them.
- **One sport per app.** Even after adding sports, forcing a separate board per sport splits the
  group's rivalry into disconnected silos.

**Cost of not solving it:** the table tennis and padel standings live in WhatsApp threads or separate
apps, the rivalry data fragments, and LOTD stops being the one place the running joke lives. The joke
is the product.

**Evidence:** the live `Seven P3` board has 7 players, but every game must be squeezed into groups of
exactly 4, so whoever sits out is invisible to the record.

---

## 2. Research

### Table tennis (ITTF, since 2001)
- A game is **first to 11**, and you must **win by 2**.
- At **10–10 (deuce)** play continues until someone leads by two: `12–10`, `15–13`, even `23–21`.
- Pre-2001 games were to 21, and some social groups still play that way — the target must be
  configurable.

**Consequences:** `11–10` is an **impossible** score, and table tennis **cannot end in a draw**
(win-by-2 guarantees a winner).

### Padel Americano / Mexicano
You always play doubles but **score as an individual** — the score your side achieves is also your
personal score. A **24-point round** finishing 15–9 gives *each* winner 15 and *each* loser 9.
Partners rotate; the points are always yours. Mexicano differs only in regenerating pairings from the
live leaderboard each round.

**Consequence — and the thing that breaks a naive design:** an Americano round is a **fixed total**
of points (`for + against == 24`), not a race to a target. A padel round *can* end 12–12, so padel
**can** draw where table tennis cannot.

### The two scoring rules

This is the core technical finding of the research:

| Rule | Sport | Validation | Draws |
|---|---|---|---|
| **`first_to`** | Table tennis | winner reaches target; optionally win-by-2 | impossible |
| **`total_points`** | Padel Americano | `for + against == target` exactly | possible (12–12) |

They are not interchangeable, so **the rule belongs to the game type**, not the board.

**Sources:** [USA Table Tennis — rules](https://www.usatt.org/rules-of-table-tennis) ·
[Table Tennis Universe — scoring](https://tabletennisuniverse.com/table-tennis-scoring-rules-complete-guide/) ·
[JudgeMate — sets, deuce & points](https://www.judgemate.com/en/guides/how-table-tennis-scoring-works) ·
[Killerspin — rules FAQ](https://www.killerspin.com/pages/faq-table-tennis-rules) ·
[Padeli — social formats](https://padeli.com/get-started/formats/) ·
[Padel Fast — Americano](https://www.padelfast.com/formats/americano) ·
[Padel Fast — Mexicano](https://www.padelfast.com/formats/mexicano) ·
[Simple Padel — Americano scoring](https://simplepadel.com/how-to-play-an-americano-in-padel/) ·
[Live For Padel — King of the Court](https://www.liveforpadel.com/blog/padel-king-of-the-court)

---

## 3. Goals

1. **One board, both sports.** Log table tennis and padel to the same standing, comparably.
2. **Log a table tennis game in under 10 seconds** — two players, `11` and `7`, save.
3. **Singles and doubles together**, no mode switch at board level.
4. **Any player count** for the card game (2–24 participants, 2–8 sides).
5. **Numbers stay honest.** Loss Index for existing card games must be *numerically identical* to
   today's loss rate ÷ 0.25.
6. **Zero regression for the card group** — today's 3-tap flow stays 3 taps.

## 4. Non-goals

1. **Not a tournament organiser.** No Americano schedule generation, no Mexicano re-pairing. *(Levi's
   explicit choice: "just record". Avoids the hardest feature in the category.)*
2. **No skill ratings (Elo/Glicko).** Changes the product from "who lost" to "who is good".
3. **No live/in-progress scoring.**
4. **No match-level record (best of 3/5).** One game is the unit; a match is several rows.
5. **No mixing points-based and loss-based games on one board.** Cards stay on their own board — see
   §7.4 for why this is the one mix with no honest maths.
6. **No per-player accounts.** Open-write model stays as decided.

---

## 5. Game types — the key concept

A **game type** is a named bundle of rules. A board **enables** one or more; each game **picks** one
and snapshots its rules.

### 5.1 Built-in game types

| Game type | Sides | Players/side | Scoring rule | Target | Win by 2 | Draws |
|---|---|---|---|---|---|---|
| **Table tennis — singles** | 2 | 1 | `first_to` | 11 | ✅ | ❌ |
| **Table tennis — doubles** | 2 | 2 | `first_to` | 11 | ✅ | ❌ |
| **Padel — Americano** | 2 | 2 | `total_points` | 24 | — | ✅ |
| **Padel — match** | 2 | 2 | `first_to` | 6 (games) | ✅ | ❌ |
| **Card game — odd one out** | 3–8 | 1 | `elimination` | — | — | ❌ |
| **Custom** | pick | pick | pick | pick | pick | pick |

Types 1–4 are **points family**; type 5 is **loss family**. A board may enable any number of types
**within one family**.

### 5.2 Why the rules live on the type, not the board

Because the group plays both sports on one board, a board-level `points_target` is meaningless — is
it 11 or 24? Attaching rules to the game type solves it, and snapshotting them onto each game row at
write time means:

- A table tennis game validates as *first to 11, win by 2*.
- A padel round logged an hour later validates as *totals must sum to 24*.
- Both live on the same board, each permanently self-describing.
- Changing a type's default later **never invalidates history**.

> **This snapshot is the mechanism that makes a single multi-sport standing possible.** Without it,
> editing the padel target would silently corrupt every table tennis game's validity.

---

## 6. Create a leaderboard — the full field spec

> The part Levi asked for specifically: what the app must ask when making a new board.

**Design principle: presets do the work.** The common path is *name → pick sports → Create*.
Everything else sits behind an **Advanced** disclosure.

### 6.1 Fields

| # | Field | Required | Default | Editable later? | Why it exists |
|---|---|---|---|---|---|
| 1 | **Name** | yes | — | ✅ rename anytime | Board identity, unique |
| 2 | **What do you play?** *(multi-select)* | yes | — | ✅ add types anytime | **Enables one or more game types.** Tick *Table tennis* and *Padel* for one combined board |
| 3 | **Scoring family** | derived | from types | ❌ **locked at first game** | `points` vs `loss` — the one mix with no honest maths (§7.4) |
| 4 | **Ranking metric** | yes | Point share | ✅ anytime | Point share / total points / loss index — a *view*, not a commitment (§6.4) |
| 5 | **Min games to rank** | yes | `5` | ✅ anytime | Provisional threshold |
| 6 | **Default game type** | no | first enabled | ✅ anytime | What the log sheet opens on |
| 7 | *(per type)* **Target** | no | type default | ✅ snapshotted per game | 11 for TT, 24 for padel |
| 8 | *(per type)* **Win by 2** | no | type default | ✅ snapshotted per game | Deuce handling |
| 9 | *(per type)* **Allow draws** | no | type default | ✅ where legal | Auto-off when win-by-2 |

### 6.2 The combined board, concretely

```
Name:            Geng Olahraga
What do you play? ☑ Table tennis — singles
                  ☑ Table tennis — doubles
                  ☑ Padel — Americano
                  ☐ Card game — odd one out     ← greyed out: different family (§7.4)
Ranking metric:   Point share
Min games:        5
```

Three taps past the name, and the board handles both sports.

Note the card game is **greyed out with an explanation**, not hidden — the UI should teach why, not
just refuse.

### 6.3 What locks, and why

Only **scoring family** locks, at the first logged game. Loss-based and points-based standings answer
different questions and cannot be merged honestly. Attempting to change returns `409` with
export-and-recreate guidance.

Everything else stays editable because of the §5.2 snapshot.

### 6.4 Ranking metric is a *view*, not a commitment

A points board stores full scores, so it also knows who won each game. **Choosing point share throws
nothing away** — standings can toggle to win/loss (Loss Index) any time from the same stored data.
The setting only decides which number leads.

---

## 7. Scoring

### 7.1 Point share — and why it makes one board possible

```
point_share = points_for / (points_for + points_against)
```

**Length-independent**, which is exactly what a multi-sport board needs:

| Game | Score | Share |
|---|---|---|
| Table tennis singles | 11–7 | `11/18 = 0.611` |
| Table tennis deuce | 15–13 | `15/28 = 0.536` |
| Padel Americano | 15–9 | `15/24 = 0.625` |

All three are the same question: *what fraction of the points on the table did you win?* Total points
could never do this — a padel round would outweigh three table tennis games purely by being longer.

Chance baseline is `1 / sides` = **0.50** for every type here, mirroring the card game's 25% for
4 sides. **Biggest loser = lowest point share.** Total points stays on screen as a secondary column
because players enjoy watching it climb.

### 7.2 Loss Index (card board)

For each **decisive** game, expected share of blame is `1 / sides`:

```
expected_losses = Σ 1 / sides(game)      over decisive games
loss_index      = actual_losses / expected_losses
```

`1.00` = exactly chance · `>1.00` = pecundang zone · `<1.00` = beating luck.

**Migration-safety property:** on an all-4-player board every game contributes 0.25, so
`loss_index = loss_rate / 0.25`, and today's "beats luck" (`<25%`) becomes exactly `loss_index < 1.0`.
**Existing standings don't change meaning** — they get a new scale.

### 7.3 The daily spotlight

LOTD's identity is the daily roast, so the daily card stays outcome-based even on a points board:

> **Today's biggest loser = most games lost today**, across whatever they played.
> Tiebreak: lowest point share today.

Losing at table tennis *and* padel on the same day should absolutely count double. All-time uses the
board's ranking metric.

### 7.4 Why cards can't join the sports board

Cards produce **no scores** — only "who lost". Sports produce scores. Point share is undefined for a
card game, and Loss Index throws away the margins that make the sports board interesting. Any merge
would silently rank people on a number that means something different per row.

**Decision: cards keep their own board.** This is a product constraint, not a technical one, and the
UI should say so plainly in the create form.

---

## 8. Score validation

### 8.1 `first_to` — table tennis

```
w > l  and  l >= 0  and  w >= target
if win_by_2:  (w == target and l <= target-2)  or  (w > target and w - l == 2)
else:          w == target
```

For `target = 11, win_by_2 = on`:

| Score | Verdict | Why |
|---|---|---|
| `11–0` … `11–9` | ✅ | clean win |
| `12–10`, `13–11`, `15–13`, `23–21` | ✅ | deuce, margin exactly 2 |
| `11–10` | ❌ **impossible** | winner must lead by 2 |
| `11–11` | ❌ | never a final score |
| `12–9`, `13–10` | ❌ | game already ended at 11–9 / 12–10 |
| `12–11` | ❌ | margin is 1 |
| `10–8` | ❌ | nobody reached 11 |
| `9–11` | ✅ | order-independent; larger side wins |

### 8.2 `total_points` — padel Americano

```
for + against == target  and  both >= 0
if not allow_draws:  for != against
```

For `target = 24`:

| Score | Verdict | Why |
|---|---|---|
| `15–9`, `24–0`, `13–11` | ✅ | sums to 24 |
| `12–12` | ✅ | draw — legal in Americano |
| `15–8` | ❌ | sums to 23 — a point is missing |
| `16–9` | ❌ | sums to 25 |
| `11–7` | ❌ | sums to 18 — that's a table tennis score on a padel round |

Error messages must teach: *"A padel round is 24 points total — 15–8 only adds to 23."* and
*"11–10 isn't possible — at 10–10 you play on until someone leads by 2."*

---

## 9. User stories

**Multi-sport (new, primary)**
- As a player, I want table tennis and padel on one standing, so there's a single running joke.
- As a player, I want the app to know a padel round is 24 points and a TT game is to 11, so I never
  have to remember which rules apply.
- As a player, I want my padel and table tennis results comparable, so the standing means something.

**Table tennis**
- As a player, I want to log a 1v1 by typing two numbers.
- As a player, I want doubles credited to me personally, so my standing reflects my night and not my
  luck with partners.
- As a player, I want an impossible score rejected with an explanation.

**Card group (must not regress)**
- As a card player, I want the same 3-tap flow as today.
- As a card player, I want to log a 5- or 6-player night.

**Everyone**
- As a player, I want to know whether I'm unlucky or actually bad.
- As a scorekeeper, I want to fix a wrong score without deleting the game.
- As a new player, I want my rank marked provisional until I've played enough.

---

## 10. Step-by-step: how to use it

### Flow A — Create the combined sports board

1. Unlock → **New leaderboard**.
2. **Name:** `Geng Olahraga`.
3. **What do you play?** tick **Table tennis — singles**, **Table tennis — doubles**, **Padel —
   Americano**. *(Card game is greyed out with "cards don't have scores — they need their own board".)*
4. *(Optional)* **Advanced** → change the padel round to 32 points, or min-games to 8.
5. **Create.**

### Flow B — Log a table tennis singles game (the 10-second path)

1. Tap **Log game**. The sheet opens on your last-used type — **Table tennis — singles**.
2. Tap the two players. *(Exactly 2 active → pre-selected.)*
3. Type `11` and `7`. The winner highlights automatically — **you never separately declare a
   winner**, it's derived from the score.
4. Tap **Simpan** → the **PECUNDANG** stamp fires for the loser, with a 4-second undo.

### Flow C — Log a padel Americano round

1. Tap **Log game** → switch type to **Padel — Americano**.
2. Tap the 4 players who were on court. Anyone sitting out simply isn't selected — **they get no
   game**.
3. Tap **Split** — deal into **Side A** / **Side B**; tap a name to move it. Header: `A: 2 · B: 2`.
4. Type the round score, e.g. `15` – `9`. A live hint reads **`24 / 24 points ✓`** as you type, so a
   miscount is caught before you save.
5. **Simpan.** Both A players get `+15 for / +9 against`; both B players the mirror. **Individual
   credit, Americano-style.**

### Flow D — Log a card game (unchanged, now any size)

1. Tap **Log game** on the card board.
2. **Who played?** tap 3–8 participants. *(Exactly 4 active → pre-selected — today's flow preserved.)*
3. **Who lost?** type `<name> pecundang`, or tap the loser's tile.
4. **Simpan.**

### Flow E — Fix a mistake

1. Unlock → **Recent games**.
2. Rows are type-labelled: `🏓 Levi 11 – 7 Rafi` · `🎾 A: Levi·Rafi 15 – 9 Nadhif·Sebas`.
3. **Edit** to correct a score or roster; **Delete** to remove it (confirm). Standings recompute
   immediately. Edits re-validate against **that game's snapshotted rules**, not today's defaults.

---

## 11. Requirements

### P0 — cannot ship without

| # | Requirement | Acceptance criteria |
|---|---|---|
| R1 | Game types as first-class, board enables 1..n within one family | Given TT-singles + TT-doubles + Padel enabled, when logging, then a type picker offers exactly those three |
| R2 | Per-game rule snapshot (`scoring_rule`, `target`, `win_by_2`, `allow_draws`) | Changing the padel target to 32 leaves existing 24-point rounds valid and correctly scored |
| R3 | Two scoring rules implemented: `first_to` and `total_points` | Every row of the §8.1 and §8.2 tables is a unit test |
| R4 | Board creation captures §6.1 fields with presets | "Table tennis + Padel" ticked → family=points, metric=point_share, both types enabled |
| R5 | Scoring family locks at first game; cards excluded from a sports board | Change attempt → `409`; card type greyed with an explanation, not hidden |
| R6 | Singles and doubles on one board | A 1v1 and a 2v2 both appear in standings, both baseline 0.50 |
| R7 | Winner derived from score, never asked separately | No "who won?" control exists in the points flow |
| R8 | Individual credit from side result | Padel 15–9 → both winners `for=15/against=9`; both losers the mirror |
| R9 | Point share ranking, total points secondary | Sorted share ascending (biggest loser first) |
| R10 | Live total hint for `total_points` types | Typing 15 and 8 shows `23 / 24` in a warning colour; save disabled |
| R11 | A player cannot appear twice in one game | `PRIMARY KEY (game_id, player_id)`; clear API error, not a 500 |
| R12 | Rules enforced at the DB layer, not only the Edge Function | Deferred trigger rejects <2 sides, empty side, ≠1 loss in elimination, invalid score for the game's own rule |
| R13 | Lossless migration of all v3 games | Post-migration gp/losses byte-identical to a pre-migration snapshot, asserted in CI |
| R14 | Card flow stays 3 interactions | 4 active → pre-selected → confess → save |
| R15 | Daily spotlight = most games lost today, across types | Tiebreak lowest share; ties render `A & B · tied` (v3 behaviour) |

### P1 — fast follow

| # | Requirement |
|---|---|
| R16 | **Per-sport breakdown** — filter the standing to one game type (settles "I'm only bad at padel") |
| R17 | Head-to-head records (`Levi beats Rafi 7–3`) — natural once singles exist |
| R18 | Toggle standings between point share and Loss Index (data already supports it) |
| R19 | Export includes types, sides, participants, scores, per-game rules; standings rebuildable from it alone |
| R20 | Points-per-game and win/loss streak columns |
| R21 | Sessions — pick the roster once, log many rounds fast |

### P2 — design for, don't build

| # | Requirement |
|---|---|
| R22 | Match-level record (best of 3/5) |
| R23 | Free-for-all ranking (1..n) for board games |
| R24 | Mexicano pairing suggestions |
| R25 | Partner-effect stats ("who drags their partner down") |
| R26 | Handicap scoring for mixed-ability play |

---

## 12. Data model

```sql
-- a board enables game types; family is derived and locked at first game
alter table leaderboards
  add column scoring_family    text not null default 'loss'
      check (scoring_family in ('loss','points')),
  add column ranking_metric    text not null default 'loss_index'
      check (ranking_metric in ('loss_index','point_share','total_points')),
  add column min_games_to_rank int not null default 5
      check (min_games_to_rank between 1 and 50),
  add column default_game_type text;

create table game_types (
  id             bigint generated always as identity primary key,
  leaderboard_id bigint not null references leaderboards(id) on delete cascade,
  key            text not null,                      -- 'tt_singles' | 'padel_americano' | …
  label          text not null,
  family         text not null check (family in ('loss','points')),
  scoring_rule   text not null check (scoring_rule in ('first_to','total_points','elimination')),
  sides_min      smallint not null default 2,
  sides_max      smallint not null default 2,
  side_size_min  smallint not null default 1,
  side_size_max  smallint not null default 2,
  points_target  int check (points_target between 1 and 99),
  win_by_2       boolean not null default false,
  allow_draws    boolean not null default false,
  unique (leaderboard_id, key)
);

create table games (
  id             bigint generated always as identity primary key,
  leaderboard_id bigint not null references leaderboards(id) on delete cascade,
  game_type_id   bigint not null references game_types(id) on delete restrict,
  game_date      date not null default current_date,
  -- rules SNAPSHOTTED at write time: history is immutable & self-describing (§5.2)
  scoring_rule   text not null,
  points_target  int,
  win_by_2       boolean,
  allow_draws    boolean,
  created_at     timestamptz not null default now(),
  check (game_date <= current_date + 1)
);

create table game_sides (
  id             bigint generated always as identity primary key,
  game_id        bigint not null references games(id) on delete cascade,
  side_no        smallint not null check (side_no between 1 and 8),
  outcome        text check (outcome in ('win','loss','draw')),
  points_for     int check (points_for >= 0),
  points_against int check (points_against >= 0),
  unique (game_id, side_no)
);

create table game_participants (
  game_id   bigint not null references games(id) on delete cascade,
  side_id   bigint not null references game_sides(id) on delete cascade,
  player_id bigint not null references players(id) on delete restrict,
  primary key (game_id, player_id)      -- ← structural: one human, one slot, per game
);
```

**Migration from v3 (lossless, reversible, idempotent):**
```
create game_type(key='odd_one_out', family='loss', scoring_rule='elimination', sides 3..8, side_size 1..1)
for each v3 game:
  create game(that type, same date/leaderboard/created_at)
  for i in 1..4:
    side = create_side(side_no=i, outcome = (p_i == loser ? 'loss' : 'win'))
    create_participant(side, p_i)
```
Then assert `SELECT name, gp, losses FROM v_standings` matches a pre-migration snapshot.
**Ship the assertion as a test, not a manual check.**

### The integrity tradeoff — read before approving

Today's "exactly 4 players, exactly 1 loser" is **structural** — the database physically cannot hold
a malformed game. That's the best property of the current design.

A flexible model **cannot** express "exactly one loser" as a column CHECK, because sides live in
another table. We trade a structural guarantee for an enforced one.

**Mitigation (all three required, non-negotiable):**
1. `PRIMARY KEY (game_id, player_id)` — a human still can't appear twice, structurally.
2. A **deferred DB trigger** validating sides/results/scores against the game's own snapshotted rule
   at COMMIT — not just app code.
3. Property tests generating malformed games, asserting the DB rejects every one.

Ship app-level validation only and the standings will eventually be wrong. Decide knowingly.

---

## 13. Edge cases & negative cases

### Multi-sport board
| # | Case | Expected behaviour |
|---|---|---|
| EC-1 | Padel round `11–7` (a table tennis score) | Rejected: *"a padel round is 24 points total — 11–7 only adds to 18"* |
| EC-2 | Table tennis game `15–9` (a padel score) | Rejected: at target 11, `15–9` has margin 6, not 2 |
| EC-3 | Padel target changed 24 → 32 mid-history | Old rounds keep `points_target=24` and stay valid (§5.2) |
| EC-4 | Game type deleted while games reference it | Blocked by `ON DELETE RESTRICT`; offer *disable* instead (hides from the picker, keeps history) |
| EC-5 | Type disabled then re-enabled | History untouched throughout |
| EC-6 | Board mixes TT (to 11) and padel (to 24) | **Allowed and comparable** — point share is length-independent (§7.1). The whole point |
| EC-7 | Adding a *loss-family* type to a points board | Rejected — family lock (§7.4) |
| EC-8 | Board enabled for padel only, user tries a singles game | Rejected: allowed types named in the error |
| EC-9 | Same player in a TT game and a padel round on one day | Fine — both count; daily spotlight aggregates across types |

### Table tennis scores (`first_to`)
| # | Case | Expected behaviour |
|---|---|---|
| EC-10 | `11–10` | Rejected: *"at 10–10 you play on until someone leads by 2"* |
| EC-11 | `11–11` | Rejected — never a final score |
| EC-12 | `12–9` / `13–10` | Rejected — game already ended at 11–9 / 12–10 |
| EC-13 | `12–11` | Rejected — margin must be exactly 2 |
| EC-14 | `10–8` | Rejected — nobody reached 11 |
| EC-15 | `15–13`, `23–21` | **Valid** — deuce can run long |
| EC-16 | `9–11` (loser typed first) | Valid; winner derived from the larger number |
| EC-17 | Equal scores | Rejected — TT has no draws |
| EC-18 | Win-by-2 turned off | `w == target` exactly; `11–10` becomes legal. Snapshotted per game |
| EC-19 | Target switched 11 → 21 | Old games keep 11; only new games validate against 21 |

### Padel scores (`total_points`)
| # | Case | Expected behaviour |
|---|---|---|
| EC-20 | `15–8` (sums to 23) | Rejected with the running total shown — *"23 / 24"* |
| EC-21 | `16–9` (sums to 25) | Rejected — *"25 / 24"* |
| EC-22 | `12–12` | **Valid** — draws are legal in Americano; both share 0.50, neither gets a loss |
| EC-23 | `24–0` | Valid |
| EC-24 | Draws disabled but `12–12` entered | Rejected with a pointer to the setting |
| EC-25 | Odd target (25) making draws impossible | Allowed; the draw case simply never arises |

### Sides & participants
| # | Case | Expected behaviour |
|---|---|---|
| EC-26 | Same player on both sides | Rejected — PK violation as *"a player can only be in a game once"* |
| EC-27 | Same player twice on one side | Same as EC-26 |
| EC-28 | 3 players on a side of a 2-per-side type | Rejected — side size capped by the type |
| EC-29 | Singles logged when only doubles enabled | Rejected, allowed types named |
| EC-30 | Fewer than 2 players / only 1 side | Rejected: *"a game needs at least 2 sides"* |
| EC-31 | Empty side after an edit | Rejected; edits atomic — no partial save |
| EC-32 | Uneven sides (2v1) where the type allows | Allowed with a UI note; baseline stays `1/sides` so size doesn't distort share |
| EC-33 | Player not in this leaderboard | Rejected (v3 rule) |
| EC-34 | Archived player added to a new game | Rejected (v3 rule) |
| EC-35 | Archived player in a historic game | Kept and counted — their games happened |
| EC-36 | Player deleted who has games | Archived, never hard-deleted (`RESTRICT`) |
| EC-37 | Player renamed mid-history | Fine — id-based |
| EC-38 | >24 participants or >8 sides | Rejected with the cap stated, not a crash |
| EC-39 | Sitting out a padel round | Not selected → **no game, no loss, no points** |

### Stats & ranking
| # | Case | Expected behaviour |
|---|---|---|
| EC-40 | Player with 0 games | Unranked, share `null`, in the "not enough games" group |
| EC-41 | Below min-games threshold | Provisional — listed, unranked (v3 behaviour) |
| EC-42 | All games drawn | `decisive_games = 0` → Loss Index undefined → provisional. Never `0/0` or `NaN`. Point share still works (0.50) |
| EC-43 | Everyone tied on the metric | Deterministic tiebreak: share asc → more games → fewer wins → name A→Z |
| EC-44 | Plays only padel, another only TT | Comparable on share, but skills differ — **known limitation**; R16 per-sport breakdown is the mitigation |
| EC-45 | Strong player dragged down by weak doubles partners | **Known limitation, accepted.** Americano's premise is it evens out; R16 resolves disputes |
| EC-46 | Latecomer with 3 games vs regular with 30 | Fair on share; min-games threshold stops a 1-game fluke topping the board |
| EC-47 | Metric switched share ↔ Loss Index | Allowed anytime — both derive from stored scores (§6.4). No migration |
| EC-48 | One player wins everything | Share → 1.0, opponent → 0.0. No divide-by-zero (`for+against` > 0) |
| EC-49 | A side scored 0 (`11–0`) | Valid; loser's contribution `0/11 = 0` |

### Time, integrity, abuse
| # | Case | Expected behaviour |
|---|---|---|
| EC-50 | Game dated in the future | Rejected (v3 rule; client supplies local `today`) |
| EC-51 | Backdated game | Allowed; lands on its own date for the daily spotlight |
| EC-52 | Timezone rollover at midnight | Client's local date wins (v3 behaviour) |
| EC-53 | Changing scoring family after games exist | `409` — export, delete, recreate |
| EC-54 | Migration run twice | Idempotent; second run a no-op |
| EC-55 | Migration loses/duplicates a game | Caught by the pre/post assertion in CI, not production |
| EC-56 | Two people logging at once | Games are independent rows; no lost updates |
| EC-57 | Editing a game after its type's defaults changed | Re-validates against the game's **snapshotted** rules, not today's |
| EC-58 | Griefing via open writes | Unchanged risk from v3 but a **larger surface**. Rate limit stays; consider a games/day cap per IP |
| EC-59 | Hand-crafted malformed request | Rejected by the trigger (why R12 exists) |
| EC-60 | Very long names | Escaped on render (`esc()`), length-capped on write |
| EC-61 | Export/import round-trip | Standings must rebuild from exported games alone — `export.test.mjs` contract extends to types, scores, and per-game rules |

---

## 14. Success metrics

**Leading (4 weeks)**
- One combined board carrying **both** table tennis and padel games.
- Median time to log a table tennis singles game **< 10 seconds**.
- Zero standings-correctness bugs.
- Invalid-score rejections occur (validation is live) but are **< 5%** of attempts (input isn't
  fighting people).

**Lagging (a quarter)**
- The group stops keeping parallel scoreboards elsewhere — just ask, n is small.
- Card logging rate unchanged (no regression).
- Both sports and both TT formats in regular use on one board.

**Guardrail**
- Card logging stays 3 taps. If it rises, we broke the thing that already works.

---

## 15. Phasing

| Phase | Scope | Why this order |
|---|---|---|
| **v4.0** | Schema + game types + migration + card game at 2–8 players + Loss Index | Riskiest change (migration) lands alone, verifiable, old numbers provably intact |
| **v4.1** | Board creation form + presets + **table tennis singles** (`first_to`) | The driving use case, smallest new UI |
| **v4.2** | Doubles + **padel Americano** (`total_points`) + live total hint | Adds the second scoring rule on proven foundations |
| **v4.3** | R16 per-sport breakdown, head-to-head, sessions | The features arguments will demand |
| **v4.4** | P2, only if asked | — |

**Do not ship v4.0 and v4.1 together.** The migration deserves its own release.

---

## 16. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Migration corrupts historic standings | **High** | Pre/post assertion test; migration alone in 4.0; export a backup first |
| Loss of structural "one loser" guarantee | **High** | Deferred trigger + property tests (R12) |
| Two scoring rules = two chances to get validation wrong | **High** | §8 tables are the test suite; rule is snapshotted so a bug can't retroactively invalidate history |
| Cross-sport comparison feels unfair | Medium | R16 per-sport breakdown; EC-44 documents the limitation honestly |
| Score validation too strict to log a real game | Medium | Teaching errors; `win_by_2` and `allow_draws` are toggles; live total hint (R10) prevents most padel errors |
| Card logging gets slower | Medium | R14 guardrail |
| Feature bloat kills a deliberately tiny app | Medium | Non-goals §4; P2 is design-only |
| Open-write griefing on a bigger surface | Low-Med | EC-58 |

---

## 17. Open questions

| # | Question | Owner | Blocking? |
|---|---|---|---|
| Q1 | **What exactly is "cappuccino"?** Not found in any padel or table tennis source, EN or ID. Club-specific name for Americano/Mexicano, a mixed variant, or different rules? Likely already covered by the model — I need the rules to confirm, and to know whether it's `first_to` or `total_points`. | Levi | Only for that type |
| Q2 | What **point total** does your group actually play padel Americano to — 16, 24, 32? Sets the default. | Levi | No |
| Q3 | Do you ever play table tennis to **21**, or is 11 universal? | Levi | No |
| Q4 | Do you play **padel matches** (real sets/games) as well as Americano rounds? If so, `Padel — match` needs enabling as a separate type. | Levi | No |
| Q5 | Should the daily spotlight be **most games lost** (recommended, keeps LOTD's identity) or **lowest share today**? | Levi | No — default set |
| Q6 | Cap on games/day per IP, given open writes? | Levi | No |

---

## Appendix A — Worked examples for tests

**A1. Table tennis singles** — Levi 11 – 7 Rafi
- Levi: `for=11, against=7`, share `0.611`, win
- Rafi: `for=7, against=11`, share `0.389`, loss

**A2. Table tennis doubles (individual credit)** — A(Levi, Rafi) 11 – 9 B(Nadhif, Sebas)
- Levi **and** Rafi: `for=11, against=9`, share `0.550`
- Nadhif **and** Sebas: `for=9, against=11`, share `0.450`
- Both members of a side get the *identical* line — the Americano rule.

**A3. Deuce** — `15–13` valid (margin exactly 2, above target). Shares `0.536` / `0.464`.

**A4. Padel Americano** — A(Levi, Rafi) 15 – 9 B(Nadhif, Sebas), target 24
- Levi and Rafi: `for=15, against=9`, share `0.625`
- Nadhif and Sebas: `for=9, against=15`, share `0.375`
- Anyone sitting out: **nothing recorded**

**A5. Padel draw** — `12–12`: both sides share `0.500`, neither gets a loss, both `gp +1`.

**A6. Mixed sports on one board — why share beats total points**
Levi plays one TT game (`11–4`) and one padel round (`15–9`).
- Total points = 26 — meaningless, because the padel round is inherently worth more.
- Share = `26 / (26 + 13) = 0.667` — comparable to anyone else's, regardless of sport.

**A7. Pure 4-player card board (migration safety)**
20 games, 8 losses → loss_rate 0.40; expected = 20 × 0.25 = 5; index = 8/5 = **1.60**.
Check: `0.40 / 0.25 = 1.60` ✓ — a rescaling, not a new judgement.

**A8. Mixed-format loss board**
| Player | Games | Losses | Expected | Index |
|---|---|---|---|---|
| Nadhif | 4× 4-player, 2× 1v1 | 3 | 4(0.25) + 2(0.5) = 2.0 | **1.50** |
| Levi | 4× 4-player, 2× 1v1 | 1 | 2.0 | **0.50** |

Identical schedules, so the comparison is fair — the entire point of the index.
