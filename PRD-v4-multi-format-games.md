# PRD v4 (revised) — Add racquet sports without touching the card game

**Status:** Draft for review · **Author:** Levi (with Claude) · **Date:** 2026-07-21
**Supersedes:** the first v4 draft (game-types / point-share model), rejected by
[the council review](COUNCIL-2026-07-21-prd-v4.md). **Extends:** [PRD v3](PRD-card-game-standings-tracker.md).

---

## TL;DR

The group plays cards, table tennis, and padel. LOTD only understands cards. v4 adds the two sports
**by adding one new table beside the card table — not by rewriting anything.**

Everything reduces to one idea the app already lives by: **a game has a losing side, and everyone on
it gets stamped PECUNDANG.** Cards pick the loser directly; a racquet game derives the loser from the
score. Either way it's a loss, and the standing ranks by losses.

**What changed from the first v4 draft** (and why this one is a third the size):

| First draft (rejected) | This draft |
|---|---|
| Generalise everything to `game → sides → participants` | **Two flat tables**: cards (untouched) + a new sports table |
| Migrate the 67 live card games | **No migration.** Cards are not touched at all |
| Give up the "exactly one loser" CHECK; replace with a deferred trigger | **Keep CHECK constraints** — a racquet game is one flat row, so the DB still guarantees it structurally. The trigger the council proved couldn't fire is never needed |
| Rank by point share | **Rank by losses (Loss Index)**, with point share only as a tiebreak |
| Two "scoring families" that can't mix | One idea — losses — so cards and sports share **one board** honestly |

**LOTD stays LOTD.** Every game still answers one question: *who lost?*

---

## 1. Problem statement

The group plays three things; the scoreboard understands one.

- A table tennis 1v1 can't be logged — the app requires exactly 4 players.
- There's no concept of a side, so doubles and padel are unrecordable.
- Scores have nowhere to go: an 11–0 thrashing and an 11–9 nailbiter would look identical.

**Cost:** the table tennis and padel rivalries live in WhatsApp threads and forget themselves. LOTD's
value is that it *remembers* — who's been losing since March. The joke is the product, and right now
two-thirds of the group's games aren't in on it.

---

## 2. Goals & non-goals

### Goals
1. **Log a racquet game in under 10 seconds** — pick players, type two scores, save.
2. **Table tennis (singles + doubles) and padel on the same board as cards**, one combined rivalry.
3. **Ranking stays loss-based and honest across game types** — a card loss and a padel loss are
   comparable via Loss Index.
4. **Zero regression, zero risk to card history** — the card table, its constraints, and its 3-tap
   flow are literally unchanged.

### Non-goals
1. **Not a tournament organiser** — no Americano schedule generation, no auto-pairing. (Benchmarked
   and rejected: 7 players on 1 court = 11 rounds for a full rotation. A generated schedule dies
   halfway. A lightweight *partner suggestion* is P1; a schedule is not.)
2. **No skill ratings (Elo/Glicko).** This tracks losing, not skill.
3. **No live/in-progress scoring** — log a finished game.
4. **No match-level record (best of 3/5).** One game is the unit.
5. **No variable card player-count (2–8) in this release.** Independent of the sports goal; deferred.
6. **No per-player accounts.** Open-write model stays.

---

## 3. The model: two tables, one rivalry

A **leaderboard** (e.g. `Seven P3`) has **players**. Those players play **card games** (today's
table) and **racquet games** (a new table). The standing unions both.

```
leaderboard ─┬─ players ──┬─ (referenced by) card games      [games — UNCHANGED]
             │            └─ (referenced by) racquet games   [sports_games — NEW]
             └─ standing = losses from cards + losses from racquet, ranked
```

- **Players are shared.** The same Levi plays cards and padel as one player row. That's what makes it
  "one place for the rivalry."
- **The two game tables never mix physically.** Cards keep their `p1..p4 + loser` shape and their
  "pick who lost" mechanic. Racquet games are a different shape with a different mechanic (derive the
  loser from the score). They only meet in a **read-only view** that adds up losses.
- **Nothing about cards changes** — not the table, not the CHECKs, not the Edge Function's card
  actions, not the 3-tap flow.

### Why a flat racquet table (and why it matters)

A racquet game is **2 sides of 1–2 players with a score.** That fits in one flat row:

```
a1, a2(nullable), b1, b2(nullable), score_a, score_b, sport
```

Because it's one row, the same trick that has kept card standings perfect — **CHECK constraints** —
enforces every rule: a valid score, no draw, distinct players, a consistent side shape. **We keep the
structural guarantee.** The deferred trigger the first draft needed (and that the council proved
couldn't fire, because writes are separate transactions) simply never exists here.

---

## 4. Scoring

### 4.1 The loser of a racquet game
The side with the **lower score** lost. **Everyone on the losing side is stamped and takes one loss**
(both players, in doubles). Singles = one loser. Cards = the one chosen loser. Same currency: a loss.

### 4.2 Ranking: Loss Index (primary)

For every game a player played, their expected share of the blame is `1 / (number of sides)`:

```
expected_losses = Σ 1/sides         cards → 0.25 each · racquet → 0.50 each
loss_index      = actual_losses / expected_losses
```

`1.00` = exactly what chance predicts · `> 1.00` = the pecundang zone · `< 1.00` = beating luck.

This is the single number that makes cards and sports comparable. A player who loses half their padel
rounds (expected) and a quarter of their card games (expected) sits at exactly `1.00` on both.
On a card-only history it equals today's `loss_rate ÷ 0.25`, so **existing standings keep their
meaning** and just gain a scale.

### 4.3 Tiebreak: point share

When players tie on Loss Index, the one who won a **smaller share of the points they played** is the
bigger loser:

```
point_share = points_for / (points_for + points_against)     -- racquet games only
```

Point share is *only* a tiebreak — it never decides #1 — so it can't invert the loser board (the
flaw that sank the first draft's plan to rank by it). It's free: we store the scores anyway to find
the loser.

**Full tiebreak chain:** Loss Index → point share (players with no scored games skip this) → games
played → name A→Z.

### 4.4 The daily stamp — "Loser of the Day"
**Most games lost today**, counting cards and racquet games together. Raw count, as today. Ties render
`A & B · tied`. This is the app's identity and it stays a simple, visceral count.

---

## 5. Score validation

A racquet row is rejected unless the score is legal for its `sport`. Both rules are pure CHECK
constraints on the row.

### Table tennis (`tt_singles`, `tt_doubles`) — first to 11, win by 2
```
w = max(a,b), l = min(a,b)
valid iff  a <> b  and  ( (w == 11 and l <= 9)  or  (w > 11 and w - l == 2) )
```

| Score | Verdict | Why |
|---|---|---|
| `11–0` … `11–9` | ✅ | clean win |
| `12–10`, `15–13`, `23–21` | ✅ | deuce, margin 2 |
| `11–10` | ❌ | must win by 2 |
| `12–9`, `13–10` | ❌ | game already ended at 11–9 / 12–10 |
| `12–11` | ❌ | margin 1 |
| `10–8` | ❌ | nobody reached 11 |

### Padel Americano — a 21-point round
```
valid iff  a + b == 21  and  a <> b     (a<>b is automatic: 21 is odd)
```

| Score | Verdict | Why |
|---|---|---|
| `13–8`, `21–0`, `11–10` | ✅ | sums to 21 |
| `13–7` | ❌ | sums to 20 |
| `14–8` | ❌ | sums to 22 |

### The test that proves the design
**`11–10` is valid padel and invalid table tennis** — same numbers, opposite verdicts, decided by the
row's own `sport`. One flat table, one CHECK, both right. This is the sharpest single unit test in v4.

---

## 6. Data model

```sql
-- NOTHING changes on: leaderboards, players, games (cards), v_standings-for-cards.

create table sports_games (
  id             bigint generated always as identity primary key,
  leaderboard_id bigint not null references leaderboards(id) on delete cascade,
  sport          text   not null check (sport in ('tt_singles','tt_doubles','padel')),
  game_date      date   not null default current_date,
  a1  bigint not null references players(id) on delete restrict,
  a2  bigint          references players(id) on delete restrict,   -- null = singles
  b1  bigint not null references players(id) on delete restrict,
  b2  bigint          references players(id) on delete restrict,
  score_a int not null check (score_a >= 0),
  score_b int not null check (score_b >= 0),
  created_at timestamptz not null default now(),

  -- no draws (TT wins by 2; padel total is odd)
  constraint decisive check (score_a <> score_b),

  -- singles ⇔ both partners null; doubles ⇔ both set
  constraint side_shape check ((a2 is null) = (b2 is null)),
  constraint shape_matches_sport check (
    (sport = 'tt_singles' and a2 is null) or
    (sport in ('tt_doubles','padel') and a2 is not null)
  ),

  -- all named players distinct (nulls ignored)
  constraint distinct_players check (
        a1 <> b1
    and (a2 is null or (a2 <> a1 and a2 <> b1 and (b2 is null or a2 <> b2)))
    and (b2 is null or (b2 <> a1 and b2 <> b1))
  ),

  -- score legal for the sport
  constraint valid_score check (
    case when sport = 'padel'
         then score_a + score_b = 21
         else (greatest(score_a,score_b) = 11 and least(score_a,score_b) <= 9)
           or (greatest(score_a,score_b) > 11 and greatest(score_a,score_b) - least(score_a,score_b) = 2)
    end
  ),

  constraint game_date_not_future check (game_date <= current_date + 1)
);

create index sports_games_board_date_idx on sports_games (leaderboard_id, game_date);
-- RLS + grants mirror the card tables: anon read-only; writes via the Edge Function only.
```

**Standings** become one view that unions per-player contributions from both tables:

- from `games` (cards): games played, losses, expected `+0.25` per game
- from `sports_games`: games played, losses (on the lower-scoring side), `points_for`/`against`,
  expected `+0.50` per game

then computes `loss_index`, `point_share`, and applies §4.3's ordering. A `category` filter
(`all` / `cards` / `racquet`) is a `WHERE` on the same view — that is the entire cost of §11's
"combined vs separate" knob.

**Board isolation backstop:** ship the composite FK `unique (id, leaderboard_id)` on players +
`(aN, leaderboard_id)` FKs on `sports_games` (and the same on the card `games` table) so a game can
only ever contain players from its own board. Verified 2026-07-21 that today's schema lacks this; it
is ~10 lines and belongs here.

---

## 7. Step-by-step: how to use it

### Log a table tennis singles game (the 10-second path)
1. **Log game → Table tennis (singles)** *(remembers your last choice)*.
2. Tap the two players.
3. Type `11` and `7`. The lower score's player is the loser — highlighted automatically. No "who
   won?" question.
4. **Simpan** → PECUNDANG stamp on the loser, 4-second undo.

### Log a padel round
1. **Log game → Padel.**
2. Tap the 4 players on court (anyone else present just isn't selected → no game for them).
3. **Split** into Side A / Side B (tap to move a name).
4. Type `13` – `8`. A live hint reads **`21 / 21 ✓`**; a miscount is caught before saving.
5. **Simpan** → both players on the `8` side stamped, each takes a loss.

### Log a card game
Unchanged. 4 players → confess `<name> pecundang` → save. Same 3 taps as today.

### Fix a mistake
Unlock → **Recent games** (labelled `🏓 Levi 11–7 Rafi` · `🎾 A: Levi·Rafi 13–8 Nadhif·Sebas` ·
`🃏 …`) → Edit / Delete. Standings recompute. Racquet edits re-run the score CHECK.

---

## 8. Requirements

### P0
| # | Requirement | Acceptance |
|---|---|---|
| R1 | `sports_games` table with all CHECKs of §6 | Every row of §5's tables is a DB-level test; malformed rows rejected by the DB, not just the app |
| R2 | Cards untouched | Card table DDL, CHECKs, Edge Function card actions, and tap-count are byte-identical to v3 |
| R3 | Log TT singles/doubles + padel via a new Edge Function action | A padel 13–8 stamps both losers; a TT 11–7 stamps one |
| R4 | Loser derived from score; both doubles losers counted | `sports_games` never stores an explicit "winner"; the lower side loses |
| R5 | Loss Index unifies cards + racquet | On a card-only board, `loss_index == loss_rate/0.25` (property test) |
| R6 | Point share as tiebreak only | Two players tied on Loss Index order by point share; a card-only player sorts by the next key |
| R7 | Daily loser = most games lost today across both tables | A day with a card loss and a padel loss counts both |
| R8 | Composite FK board isolation | A cross-board racquet insert fails (today it silently succeeds) |
| R9 | `11–10` valid as padel, invalid as TT | Single CHECK keyed on `sport`; both directions unit-tested |

### P1
| # | Requirement |
|---|---|
| R10 | Standing filter: All / Cards / Racquet (one `WHERE`) |
| R11 | `v_partnerships` — who's partnered whom, win/loss together → "you've never won a round with Sebas" (roast material) |
| R12 | Per-sport breakdown ("I'm only bad at padel") |
| R13 | Head-to-head singles records (`Levi beats Rafi 7–3`) |
| R14 | Export includes racquet games; standings rebuildable from export alone |

### P2
| # | Requirement |
|---|---|
| R15 | Variable card player-count (2–8) |
| R16 | Partner suggestion (Tier 1, from `v_partnerships`) |
| R17 | Configurable TT target (21) / padel total |

---

## 9. Edge cases

### Scores
| # | Case | Behaviour |
|---|---|---|
| EC-1 | TT `11–10` | Rejected — win by 2 |
| EC-2 | TT `12–9` / `13–10` | Rejected — game already ended |
| EC-3 | TT `15–13`, `23–21` | Valid — deuce |
| EC-4 | Padel `13–7` (sums 20) | Rejected — live hint shows `20/21` |
| EC-5 | Padel `11–10` | Valid — sums to 21 (contrast EC-1) |
| EC-6 | Equal scores any sport | Rejected — `decisive` CHECK; racquet has no draws |
| EC-7 | Score typed loser-first (`7–11`) | Fine — loser is the lower side regardless of column |
| EC-8 | Absurd `99–97` (valid TT) | Accepted but UI flags "unusually long" — surface typos, don't police |

### Sides & players
| # | Case | Behaviour |
|---|---|---|
| EC-9 | Same player on both sides | Rejected — `distinct_players` CHECK |
| EC-10 | Singles with a partner set, or doubles missing one | Rejected — `side_shape` / `shape_matches_sport` |
| EC-11 | Player from another board | Rejected — composite FK (R8) |
| EC-12 | Archived player in a new game | Rejected (mirror the card rule in the Edge Function) |
| EC-13 | Archived player in a past game | Kept and counted |
| EC-14 | Player deleted who has racquet games | Archived, never hard-deleted (FK `RESTRICT`) |
| EC-15 | Same human plays cards and padel | One shared player row; both count toward one standing |

### Stats & ranking
| # | Case | Behaviour |
|---|---|---|
| EC-16 | Card-only player vs racquet player, tied on Loss Index | Card-only player has no point share → falls to games-played tiebreak |
| EC-17 | Player with only draws | N/A for racquet (no draws); cards unchanged |
| EC-18 | Player below the provisional threshold | Listed, unranked (v3 behaviour retained) |
| EC-19 | Loss Index with 0 games | `null`, unranked, no divide-by-zero |
| EC-20 | Doubles: one strong player, weak partner | Both take the loss — you lose as a pair. Known and accepted (per-sport + partnership views soften it) |
| EC-21 | Someone plays only singles, another only doubles | Comparable on Loss Index (both 2-side); point share differs but is only a tiebreak |

### Integrity & time
| # | Case | Behaviour |
|---|---|---|
| EC-22 | Future-dated game | Rejected (client supplies local `today`) |
| EC-23 | Backdated game | Allowed; lands on its own day |
| EC-24 | Hand-crafted malformed racquet insert | Rejected by CHECKs — structural, not just app-level |
| EC-25 | Two people logging at once | Independent rows; no lost updates |
| EC-26 | Export/import round-trip | Standings rebuild from cards + racquet exports alone |

---

## 10. The one open decision

**Combined standing, or separate?** Both run on the exact same two tables; the only difference is
whether the standings view unions cards + racquet or filters to one.

- **Recommended: combined, with an All / Cards / Racquet filter (R10).** One rivalry, one daily loser
  across everything — which was the whole point — and the per-category view is a free `WHERE`.

Everything else in this PRD is decided. If you pick combined, there are no blocking questions left.

---

## 11. Phasing

| Phase | Scope | Risk |
|---|---|---|
| **v4.0** | `sports_games` table + CHECKs + composite-FK backstop; Loss Index in the standings view; **no card changes** | Low — additive; cards untouched |
| **v4.1** | Log flow for TT singles + padel; combined standing with filter | Low |
| **v4.2** | TT doubles; point-share tiebreak; recent-games edit for racquet | Low |
| **v4.3** | `v_partnerships`, per-sport breakdown, head-to-head | Low |

No phase migrates data. No phase touches the card write path. Any phase can ship alone.

---

## 12. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Card standings regress | **Low** (was High) | Cards literally untouched; the only shared surface is a read-only view |
| Lost structural guarantee | **None** (was High) | Racquet games are flat rows with CHECKs — same guarantee as cards. No trigger needed |
| Migration corrupts history | **None** (was High) | There is no migration |
| Loss Index confuses players | Medium | Show a plain sentence too: "Nadhif loses 1.4× more than chance"; keep raw L and GP visible |
| Point-share variance | **Low** (was High) | It's a tiebreak, not the ranking — it can't invert the board |
| Open-write griefing, bigger surface | Low-Med | Rate limit stays; consider a games/day cap |
| Feature bloat | Medium | P2 is design-only; §2 non-goals hold the line |

---

## 13. Open questions

All prior blockers are resolved (loss-based ranking, cards untouched, doubles = both stamped, padel
21, no schedule generation). Remaining, none blocking:

| # | Question | Default |
|---|---|---|
| Q1 | Combined vs separate standing (§10) | Combined + filter |
| Q2 | Ever play TT to 21? | 11; target is per-sport if needed |
| Q3 | Cap on games/day per IP? | None for now |

---

## Appendix A — worked examples (test vectors)

**A1. TT singles** — Levi 11 – 7 Rafi → Rafi loses (lower). Levi `for=11/against=7`, share `0.611`.

**A2. TT doubles** — A(Levi,Rafi) 11 – 9 B(Nadhif,Sebas) → **both** Nadhif & Sebas lose; each
`for=9/against=11`, share `0.450`. Levi & Rafi `0.550`, no loss.

**A3. Padel** — A(Levi,Rafi) 13 – 8 B(Nadhif,Sebas), target 21 → both of B lose; share `8/21=0.381`.
Anyone sitting out: nothing recorded.

**A4. `11–10` two ways** — as padel: valid (sums 21), the `10` side loses. As TT: rejected (margin 1).
Same numbers, opposite outcomes — the load-bearing unit test.

**A5. Loss Index across game types** — Levi: 20 card games (lost 6) + 10 padel rounds (lost 4).
Expected = 20(0.25) + 10(0.50) = 10. Actual = 10. `loss_index = 1.00` — dead average across both.

**A6. Migration safety (there is no migration, but the metric must still line up)** — a card-only
player, 20 games, 8 losses → `loss_rate 0.40`; expected `5`; `index = 1.60 = 0.40/0.25`. ✓ The card
standing's meaning is preserved exactly.

**A7. Tiebreak** — Nadhif and Sebas both at Loss Index `1.30`. Nadhif point share `0.42`, Sebas
`0.48` → Nadhif ranks as the bigger loser (won a smaller share). A card-only player tied with them,
having no point share, is ordered by games played instead.
